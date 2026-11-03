import { isDirectoryOrMissing } from "../../../lib/orca";
import { requirement } from "../../../lib/oclif/requirements";

/**
 * Refuses a project directory that is a file, or lies under one, before
 * anything reads inside it. A `--cwd` that does not exist yet is the new app's
 * directory, created with the app.
 */
export const directory = requirement({
  refusal: {
    message: "{cwd} is not a directory",
    hint: "Point --cwd at the app's directory, or at one that does not exist yet for setup to create.",
  },
  resolve: async ({ meta }) => {
    if (!(await isDirectoryOrMissing(meta.cwd))) {
      return undefined;
    }
    return meta.cwd;
  },
});
