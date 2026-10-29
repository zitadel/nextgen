import type { Git } from "../git";
import type { Check } from "../operation";
import type { PathFilter } from "../types";
import { STAGED_FILES } from "./staged-files";

/** No staged file is one `except` matches. Checked, not assumed: `reset` succeeds for a path it did not match. */
export class NothingExcludedIsStaged implements Check {
  private readonly except: PathFilter;

  /** Checks against `except`. */
  constructor(except: PathFilter) {
    this.except = except;
  }

  /** Which excluded file is still staged, or null. */
  async problem(git: Git): Promise<string | null> {
    const leaked = (await git.run(STAGED_FILES)).paths().find(this.except);
    if (leaked === undefined) {
      return null;
    }
    return `${leaked} could not be kept out of the commit, so nothing was committed`;
  }
}
