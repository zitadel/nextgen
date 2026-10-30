import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import type { UncommittedFile } from "../types";

/** The uncommitted files under the directory, untracked ones included, each file of an untracked directory listed. */
export class UncommittedFiles implements Operation<UncommittedFile[]> {
  /** Where the directory sits in the repository, e.g. `apps/web/`: what `status` puts before each path. */
  private readonly prefix: string;

  /** Lists the files under the directory at `prefix`. */
  constructor(prefix: string) {
    this.prefix = prefix;
  }

  /** Nothing to check. */
  checks(): Check[] {
    return [];
  }

  /** Never refused. */
  refused(): UncommittedFile[] {
    return [];
  }

  /**
   * Asks git for the status of the directory.
   *
   * `-- .` keeps a sibling package's work out. `--untracked-files=all` names
   * each file of an untracked directory rather than the directory alone.
   * `status` names paths from the repository root, so the prefix is taken off;
   * a rename or a copy carries a second entry, where it came from, which is
   * skipped.
   */
  async run(git: Git): Promise<UncommittedFile[]> {
    const result = await git.run([
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]);
    const unread = result.paths().values();
    const files: UncommittedFile[] = [];
    for (const entry of unread) {
      const path = entry.slice(3);
      const untracked = entry.startsWith("??");
      if (path.startsWith(this.prefix)) {
        files.push({ path: path.slice(this.prefix.length), untracked });
      } else {
        files.push({ path, untracked });
      }
      if (/^(R|C|.R|.C)/.test(entry)) {
        unread.next();
      }
    }
    return files;
  }
}
