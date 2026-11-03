import { requirement, unmet } from "../../../lib/oclif/requirements";
import { hasZitadelConfig } from "../../../lib/project";
import { inspectWorktree } from "../initial-commit";

/**
 * Refuses a repository git cannot answer about. Setup commits the files it
 * writes and will not do that without knowing the tree started clean, so
 * going ahead would risk committing the very work this check protects.
 */
export const worktreeAnswerable = requirement({
  refusal: {
    code: "E_CONFLICT",
    message: "Could not tell whether the git working tree is clean: {reason}",
    hint:
      "Setup commits the files it writes, and will not do that without knowing the tree " +
      "started clean. Fix what git is reporting, then run setup again, or pass --no-git to " +
      "set up without touching version control.",
  },
  resolve: async ({ flags, meta }) => {
    if (flags.git === false || (await hasZitadelConfig(meta.cwd))) {
      return true as const;
    }
    const state = await inspectWorktree(meta.cwd);
    if (state.kind === "unknown") {
      return unmet({
        reason: state.reason,
      });
    }
    return true as const;
  },
});
