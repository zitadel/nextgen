import type { Git } from "../git";
import type { Check } from "../operation";

/** `commit` is a commit in local history; a shallow clone may lack it. */
export class CommitIsHere implements Check {
  private readonly commit: string;

  /** Checks for `commit`. */
  constructor(commit: string) {
    this.commit = commit;
  }

  /** Why the commit cannot be used, or null. */
  async problem(git: Git): Promise<string | null> {
    // Only an object id is handed to git.
    if (!/^[0-9a-f]{4,64}$/i.test(this.commit)) {
      return `${this.commit} is not a commit id`;
    }
    const result = await git.run(["cat-file", "-e", `${this.commit}^{commit}`], [1, 128]);
    if (result.succeeded()) {
      return null;
    }
    return `${this.commit} is not in this repository's history`;
  }
}
