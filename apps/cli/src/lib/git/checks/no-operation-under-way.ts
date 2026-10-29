import type { Git } from "../git";
import type { Check } from "../operation";

/** No merge, rebase, cherry-pick, revert or bisect is under way, so a commit lands where meant. */
export class NoOperationUnderWay implements Check {
  /** "a merge is in progress" and the like, or null. */
  async problem(git: Git): Promise<string | null> {
    // The file each operation keeps in the git directory while it is under way, and its name.
    const operations = [
      { marker: "MERGE_HEAD", name: "a merge" },
      { marker: "rebase-merge", name: "a rebase" },
      { marker: "rebase-apply", name: "a rebase" },
      { marker: "CHERRY_PICK_HEAD", name: "a cherry-pick" },
      { marker: "REVERT_HEAD", name: "a revert" },
      { marker: "BISECT_LOG", name: "a bisect" },
    ];
    // `--git-path` finds each marker for this worktree, which in a linked worktree is not under `.git/`.
    const args = operations.flatMap((operation) => ["--git-path", operation.marker]);
    const paths = (await git.run(["rev-parse", ...args])).text().split("\n");
    const found = operations.find((_, index) => git.exists(paths[index] ?? ""));
    if (found === undefined) {
      return null;
    }
    return `${found.name} is in progress`;
  }
}
