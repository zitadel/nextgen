import { posix } from "node:path";
import { Flags } from "@oclif/core";

import { isEnvironmentName } from "@/lib/environment";

import { nonBlankString } from "./flags";
import { refusalError } from "./refusal";

/**
 * The flags that choose the environment a command runs against, spread into
 * the `baseFlags` of {@link import("./environment-command").EnvironmentCommand}.
 * Kept as a bag of their own so a test can check them against every other bag
 * for a clashing name or short form.
 */
const environmentNameFlag = Flags.custom<string>({
  parse: async (given) => {
    const input = given.trim();
    if (!isEnvironmentName(input)) {
      throw refusalError(
        {
          message: '"{value}" is not a usable environment name',
          hint: 'Use letters, digits, dot, dash and underscore, and no "..", and not `local` or a name ending in `.local`.',
        },
        {
          value: input,
        },
      );
    }
    return input;
  },
});

export const environmentFlags = {
  env: environmentNameFlag({
    char: "e",
    description:
      "Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then development.",
  }),
  "env-file": nonBlankString({
    description:
      "Read ZITADEL_* values from this file ahead of the process environment. A relative path is read from the current directory, not from --cwd. Cannot be combined with --env.",
  }),
};

/**
 * A file in the project directory, as `--env-file` names it: relative to the
 * shell's directory, so a run with `--cwd` puts that directory in front. Node
 * reads `--env-file` from anywhere on the command line before the CLI starts,
 * from the shell's directory, and exits when the file is not there; a path
 * relative to `--cwd` would stop the suggested command before it runs.
 */
export function projectEnvFile(cwd: string | undefined, file: string): string {
  return cwd === undefined ? file : posix.join(cwd, file);
}
