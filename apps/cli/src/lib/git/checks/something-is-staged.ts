import type { Git } from "@/lib/git/git";
import type { Check } from "@/lib/git/operation";

/**
 * Something is staged, so a commit has something to record.
 *
 * When everything was excluded, or nothing changed, the answer is "there was
 * nothing to commit" rather than an empty commit or git's own refusal.
 */
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
