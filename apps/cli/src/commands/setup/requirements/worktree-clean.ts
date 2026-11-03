import { requirement, unmet } from "../../../lib/oclif/requirements";
import { hasZitadelConfig } from "../../../lib/project";
import { inspectWorktree } from "../initial-commit";

function plural(list: readonly unknown[]): string {
  return list.length === 1 ? "" : "s";
}

/**
 * Refuses a repository with anything uncommitted that the CLI did not write.
 * Setup commits what it wrote, and it can only tell its own files from the
 * developer's when the tree starts clean; committing someone's work in
 * progress under setup's name is worse than any diff it would buy. A dry run is
 * refused too, since previewing success on a repository the real run would
 * refuse is a worse lie than refusing early.
 */
export const worktreeClean = requirement({
  refusal: {
    code: "E_CONFLICT",
    message: "The git working tree has {parts}",
    hint:
      "Setup commits the project directory so the first release records a commit, and it will not " +
      "do that while there is work it did not write, which would be committed under setup's name. " +
      "Run `git status` to see them, commit or stash them, then run setup again. If you have just scaffolded " +
      "the app yourself, committing it first is the expected step. To set up without touching " +
      "version control at all, pass --no-git.",
    details: {
      modified: "{modified}",
      untracked: "{untracked}",
    },
  },
  resolve: async ({ flags, meta }) => {
    if (flags.git === false || (await hasZitadelConfig(meta.cwd))) {
      return true as const;
    }
    const state = await inspectWorktree(meta.cwd);
    if (state.kind !== "dirty") {
      return true as const;
    }
    const parts = [
      state.modified.length > 0
        ? `${state.modified.length} uncommitted change${plural(state.modified)}`
        : undefined,
      state.untracked.length > 0
        ? `${state.untracked.length} untracked file${plural(state.untracked)}`
        : undefined,
    ].filter((part) => part !== undefined);
    return unmet({
      parts: parts.join(" and "),
      modified: state.modified,
      untracked: state.untracked,
    });
  },
});
