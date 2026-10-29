import type { Git } from "../git";
import type { Check } from "../operation";

/** HEAD is a branch, so a commit is not lost on a detached HEAD. A branch with no commit yet counts. */
export class HeadIsOnABranch implements Check {
  /** Why a commit here would be lost, or null. */
  async problem(git: Git): Promise<string | null> {
    const result = await git.run(["symbolic-ref", "--quiet", "HEAD"], [1]);
    if (result.succeeded()) {
      return null;
    }
    return "HEAD is detached, so the commit would be on no branch";
  }
}
