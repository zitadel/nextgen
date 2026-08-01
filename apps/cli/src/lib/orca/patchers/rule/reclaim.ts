import { access } from "node:fs/promises";
import { join } from "node:path";

import { MANAGED_MARKER } from "../../../paths";
import type { FileOp, ScaffoldPlan } from "./file-writer/types";

/**
 * The subset of a patcher plan's operations that `doctor --fix` re-applies:
 * env merges, gitignore entries, dependency additions, marker-bearing managed
 * files (framework routes/middleware), and the `edit` transforms — the
 * `/__nextgen` dev proxy merged into `vite.config`/`nuxt.config`/`angular.json`
 * and the Angular `dev` script added to `package.json`. Every `edit` transform
 * is idempotent and only adds what is missing (an existing value is left as-is,
 * the transform returning the source unchanged), so replaying one restores a
 * removed managed block without clobbering the user's own edits. Deliberately
 * excludes the unmarked `.zitadel/` resource writes and `zitadel.json` — those
 * are user-editable and synced by `apply`, so `--fix` must not clobber them.
 *
 * Pure: filters a freshly-allocated list; the input plan is not mutated.
 */
export function reclaimableOps(plan: ScaffoldPlan): FileOp[] {
  return plan.ops.filter(
    (op) =>
      op.kind === "merge-env" ||
      op.kind === "append-gitignore" ||
      op.kind === "add-dep" ||
      op.kind === "edit" ||
      (op.kind === "write" && op.contents.includes(MANAGED_MARKER)),
  );
}

/**
 * Narrow a reclaimable op list to what a missing-only repair may replay:
 * content ops (`write`, and `edit` marked `overwrites`) survive only when
 * their target file does not exist, so the repair can restore a deleted
 * managed file but can never touch an edited or user-adopted one. Merging
 * `edit` transforms and the additive kinds (`merge-env`, `append-gitignore`,
 * `add-dep`) pass through — they are idempotent and only add what is missing.
 * Reads the filesystem; paths resolve against `cwd` like the file-writer's.
 */
export async function withoutExistingTargets(
  ops: ReadonlyArray<FileOp>,
  cwd: string,
): Promise<FileOp[]> {
  const kept: FileOp[] = [];
  for (const op of ops) {
    if (op.kind === "write") {
      if (!(await exists(join(cwd, op.path)))) {
        kept.push(op);
      }
      continue;
    }
    if (op.kind === "edit" && op.overwrites) {
      const candidates = typeof op.path === "string" ? [op.path] : op.path;
      const present = await Promise.all(
        candidates.map((candidate) => exists(join(cwd, candidate))),
      );
      if (!present.includes(true)) {
        kept.push(op);
      }
      continue;
    }
    kept.push(op);
  }
  return kept;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
