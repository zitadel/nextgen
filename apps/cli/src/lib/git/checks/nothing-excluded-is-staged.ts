import type { Git } from "@/lib/git/git";
import type { Check } from "@/lib/git/operation";
import type { PathFilter } from "@/lib/git/types";

/**
 * No staged file is one `except` matches.
 *
 * The last guard before a commit. {@link StagingArea.addAll} already leaves
 * excluded files out, but a file committed once cannot be taken out of
 * history, so what is about to be committed is checked rather than trusted.
 */
export class NothingExcludedIsStaged implements Check {
  private readonly except: PathFilter;

  /** Checks against `except`. */
  constructor(except: PathFilter) {
    this.except = except;
  }

  /** Which excluded file is still staged, or null. */
  async problem(git: Git): Promise<string | null> {
    const leaked = (await git.stagedFiles()).find(this.except);
    if (leaked === undefined) {
      return null;
    }
    return `${leaked} could not be kept out of the commit, so nothing was committed`;
  }
}
