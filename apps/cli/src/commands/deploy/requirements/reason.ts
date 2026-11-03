import { deployMessage } from "../../../lib/release";
import { requirement } from "../../../lib/oclif/requirements";

/**
 * Why a deploy happened: the message it was given, or the one its environment
 * implies. Interactively the reason can be left off, but a non-interactive
 * caller with none to fall back on must name one, refused before anything is
 * built. A dry run records nothing, so it neither resolves nor needs one.
 */
export const reason = requirement({
  refusal: {
    message: "A deploy needs a message in non-interactive mode",
    hint: "Pass -m/--message with a short summary of what this release changes, or deploy from a clean git commit.",
  },
  resolve: async ({ flags, meta }) => {
    if (meta.dryRun) {
      return {
        message: undefined,
      };
    }
    const message = await deployMessage(
      typeof flags.message === "string" ? flags.message : undefined,
      meta.cwd,
      meta.env,
    );
    if (meta.nonInteractive && message === undefined) {
      return undefined;
    }
    return {
      message,
    };
  },
});
