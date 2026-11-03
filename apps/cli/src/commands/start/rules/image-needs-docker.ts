import { type Rule, refuses } from "../../../lib/oclif/rules";

/**
 * Refuses `--image` beside `--runtime binary`: an image is a container's, and
 * the npm binary runtime has none to run.
 */
export const imageNeedsDockerRule: Rule = refuses(
  (view) => {
    return view.flags.runtime === "binary" && view.flags.image !== undefined;
  },
  {
    message: "--image requires --runtime docker",
    hint: "Use `zitadel start --runtime docker --image <tag>`, or omit --image for the npm binary runtime.",
  },
);
