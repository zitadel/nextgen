import { nonBlankString } from "./flags";

/**
 * The flags that choose the environment a command runs against, spread into
 * the `baseFlags` of {@link import("./environment-command").EnvironmentCommand}.
 * Kept as a bag of their own so a test can check them against every other bag
 * for a clashing name or short form.
 */
export const environmentFlags = {
  env: nonBlankString({
    char: "e",
    description:
      "Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then development.",
  }),
  "env-file": nonBlankString({
    description:
      "Read ZITADEL_* values from this file ahead of the process environment. Cannot be combined with --env.",
  }),
};
