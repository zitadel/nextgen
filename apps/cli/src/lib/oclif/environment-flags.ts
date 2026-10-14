import { shellArg } from "../shell";
import { nonBlankString } from "./flags";
import { asEnvironmentSelector, type EnvironmentSelector } from "../suggestion";

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
      "Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then development.",
  }),
  "env-file": nonBlankString({
    description:
      "Read ZITADEL_* values from this file ahead of the process environment. Cannot be combined with --env.",
  }),
};

/**
 * The `--env`/`--env-file`/`--server` suffix — a leading-space string, or empty
 * — that reproduces an invocation's environment selection, appended to a
 * `zitadel` command a run suggests so the retry resolves the same server,
 * project and credential instead of silently falling back to the default
 * environment and quietly targeting the wrong project.
 *
 * This is the single source for the suffix format. {@link
 * import("./environment-command").EnvironmentCommand.environmentSelector}
 * derives these arguments from its resolved environment; a command that only
 * reads the raw flags (e.g. `doctor`, which is not an `EnvironmentCommand` but
 * still honours `--env`/`--env-file`) passes them straight through. Only a
 * value that actually came from a flag is reproduced — `--env` and `--env-file`
 * are mutually exclusive, and `--server` can accompany either; an inherited
 * value needs no flag because the next run in the same environment inherits it.
 */
export function environmentSelectorSuffix(input: {
  /** `--cwd` as typed: the project the run was about, and what `--env-file` resolves against. */
  cwd?: string;
  envFile?: string;
  envName?: string;
  server?: string;
}): EnvironmentSelector {
  const parts: string[] = [];
  if (input.envFile !== undefined) {
    parts.push(`--env-file ${shellArg(input.envFile)}`);
  } else if (input.envName !== undefined) {
    parts.push(`--env ${shellArg(input.envName)}`);
  }
  if (input.server !== undefined) {
    parts.push(`--server ${shellArg(input.server)}`);
  }
  // Last, as the least interesting part to read; flag order does not matter.
  if (input.cwd !== undefined) {
    parts.push(`--cwd ${shellArg(input.cwd)}`);
  }
  return asEnvironmentSelector(parts.length === 0 ? "" : ` ${parts.join(" ")}`);
}
