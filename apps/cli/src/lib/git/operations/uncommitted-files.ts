import type { Git } from "@/lib/git/git";
import type { Check, Operation } from "@/lib/git/operation";
import type { UncommittedFile } from "@/lib/git/types";

/**
 * The uncommitted files under the directory, untracked ones included, each file of an untracked directory listed.
 *
 * What a commit of the whole directory would sweep in. In a monorepo a
 * sibling package's work is not listed, since a commit here never touches
 * it. Each path is named from the directory, as the developer sees it.
 */
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
   * reported as the file's `from` rather than as a file of its own.
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
      const path = this.named(entry.slice(3));
      const untracked = entry.startsWith("??");
      if (/^(R|C|.R|.C)/.test(entry)) {
        const source = unread.next().value;
        files.push(
          source === undefined
            ? { path, untracked }
            : { path, untracked, from: this.named(source) },
        );
      } else {
        files.push({ path, untracked });
      }
    }
    return files;
  }

  /** A path as `status` printed it, named from the directory when it is under it. */
  private named(path: string): string {
    return path.startsWith(this.prefix) ? path.slice(this.prefix.length) : path;
  }
}
