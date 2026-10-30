import type { Git } from "../git";
import type { Check } from "../operation";

/** `commit` is a commit in local history; a shallow clone may lack it. */
export class CommitIsHere implements Check {
  private readonly commit: string;

  /** Checks for `commit`. */
  constructor(commit: string) {
    this.commit = commit;
  }

  /**
   * Why the commit cannot be used, or null.
   *
   * Only a full object id (40 characters, or 64 in a SHA-256 repository) is
   * handed to git. A shorter one could be a branch or tag name such as `beef`,
   * which git would resolve, or an abbreviation matching several objects; and
   * anything else could be read as an option.
   */
  async problem(git: Git): Promise<string | null> {
    if (!/^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(this.commit)) {
      return `${this.commit} is not a commit id`;
    }
    const result = await git.run(["cat-file", "-e", `${this.commit}^{commit}`], [1, 128]);
    if (result.succeeded()) {
      return null;
    }
    return `${this.commit} is not in this repository's history`;
  }
}
