import type { Git } from "../git";
import type { Check } from "../operation";
import { STAGED_FILES } from "./staged-files";

/** Something is staged, so a commit has something to record. */
export class SomethingIsStaged implements Check {
  /** That nothing is staged, or null. */
  async problem(git: Git): Promise<string | null> {
    const staged = (await git.run(STAGED_FILES)).paths();
    if (staged.length > 0) {
      return null;
    }
    return "there was nothing to commit";
  }
}
