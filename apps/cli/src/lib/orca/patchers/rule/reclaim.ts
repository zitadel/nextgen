import { MANAGED_MARKER } from "../../../paths";
import type { FileOp, ScaffoldPlan } from "./file-writer/types";

/**
 * The subset of a patcher plan's operations that `doctor --fix` re-applies:
 * env merges, gitignore entries, dependency additions, and marker-bearing
 * managed files (framework routes/middleware). Deliberately excludes the
 * unmarked `.zitadel/` resource writes and `zitadel.json` — those are
 * user-editable and synced by `apply`, so `--fix` must not clobber them.
 *
 * Pure: filters a freshly-allocated list; the input plan is not mutated.
 */
export function reclaimableOps(plan: ScaffoldPlan): FileOp[] {
  return plan.ops.filter(
    (op) =>
      op.kind === "merge-env" ||
      op.kind === "append-gitignore" ||
      op.kind === "add-dep" ||
      (op.kind === "write" && op.contents.includes(MANAGED_MARKER)),
  );
}
