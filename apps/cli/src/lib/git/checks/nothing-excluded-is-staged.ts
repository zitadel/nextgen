import type { Git } from "../git";
import type { Check } from "../operation";
import type { PathFilter } from "../types";

/**
 * No staged file is one `except` matches.
 *
 * Checked, not assumed: `git reset` reports success for a path it did not
 * match, and a file committed once cannot be taken out of history.
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
