import { requirement, unmet } from "../../../lib/oclif/requirements";
import { hasZitadelConfig } from "../../../lib/project";
import { inspectWorktree } from "../initial-commit";

/**
 * Refuses a repository where a commit would land where it should not: during a
 * merge, rebase, cherry-pick, revert or bisect, or on a detached HEAD. Found
 * only at commit time, setup would already have done all its work.
 */
export const worktreeCommittable = requirement({
  refusal: {
    code: "E_CONFLICT",
    message: "Setup cannot commit here: {blocked}",
    hint:
      "Setup commits the project so the first release records a commit. Finish or abort what " +
      "is under way, or check out a branch, then run setup again, or pass --no-git to set up " +
      "without touching version control.",
  },
  resolve: async ({ flags, meta }) => {
    if (flags.git === false || (await hasZitadelConfig(meta.cwd))) {
      return true as const;
    }
    const state = await inspectWorktree(meta.cwd);
    if (state.kind === "blocked") {
      return unmet({
        blocked: state.blocked,
      });
    }
    return true as const;
  },
});
