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

/**
 * The flags the `preview` command adds on top of the environment ones: which
 * preview URLs to deploy to and for how long. Kept as a bag so `preview` can
 * spread them while `preview list` and `preview rm`, which share the preview
 * credential but take neither, stay free of them.
 */
export const previewFlags = {
  origin: nonBlankString({
    description:
      "A preview URL to deploy to, instead of detecting them from the platform build. Repeatable.",
    multiple: true,
  }),
  ttl: nonBlankString({
    description: "How long each preview stays live, e.g. 7d, 12h or 90m. Between 60s and 30d.",
    default: "7d",
  }),
};
