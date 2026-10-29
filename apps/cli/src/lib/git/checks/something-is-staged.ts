import type { Git } from "../git";
import type { Check } from "../operation";

/** Something is staged, so a commit has something to record. */
export class SomethingIsStaged implements Check {
  /** That nothing is staged, or null. */
  async problem(git: Git): Promise<string | null> {
    const staged = await git.stagedFiles();
    if (staged.length > 0) {
      return null;
    }
    return "there was nothing to commit";
  }
}
