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
