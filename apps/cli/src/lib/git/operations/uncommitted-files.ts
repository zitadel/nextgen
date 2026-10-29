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

  /** Asks git for the status of the directory. */
  async run(git: Git): Promise<UncommittedFile[]> {
    const result = await git.run([
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]);
    // A rename or copy carries a second entry, where it came from, which is skipped.
    const entries = result.paths();
    const files: UncommittedFile[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] ?? "";
      let path = entry.slice(3);
      if (path.startsWith(this.prefix)) {
        path = path.slice(this.prefix.length);
      }
      files.push({ path, untracked: entry.startsWith("??") });
      if (/^(R|C|.R|.C)/.test(entry)) {
        index += 1;
      }
    }
    return files;
  }
}
