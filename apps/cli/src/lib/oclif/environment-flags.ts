import { posix } from "node:path";

import { Flags } from "@oclif/core";

import { Cmd } from "../cmd";
import { isEnvironmentName } from "../environment";
import { nonBlankString } from "./flags";
import { refusalError } from "./refusal";
import { asEnvironmentSelector, type EnvironmentSelector } from "../suggestion";

/**
 * The flags that choose the environment a command runs against and the
 * credential it connects with, spread into the `baseFlags` of
 * {@link import("./environment-command").EnvironmentCommand}. Kept as a bag of
 * their own so a test can check them against every other bag for a clashing
 * name or short form.
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
  credential: Flags.option({
    options: ["project", "login"] as const,
    description:
      "Connect with this credential and no other: project, the project secret from wherever it resolves, or login, your `zitadel login` sign-in. Without it, a secret this run names (the process environment, --env-file, or a chosen --env) wins, then your sign-in to the server, then the secret setup stored.",
  })(),
};

/**
 * `--credential` hidden from a command that takes the environment flags but
 * never connects with a credential the run chooses: `login`, `whoami`,
 * `logout` and `env` keep their own, `preview` and `claim` always use the
 * project secret, and `doctor` and the `auth-method` edits check or connect
 * with what they always have. It still parses, so a suggestion that carries
 * another run's selector runs there too.
 */
export const ignoredCredentialFlag = {
  ...environmentFlags.credential,
  hidden: true,
} as typeof environmentFlags.credential;

/**
 * Every spelling of the options that choose the project a command runs
 * against and the credential it connects with: the environment flags above
 * and the base flags `--server` and `--cwd`, each with its short form. A retry
 * suggestion strips these from the words as typed, because the run puts its
 * own selector back on.
 */
export const ENVIRONMENT_SELECTOR_OPTIONS: readonly string[] = [
  "--env",
  "-e",
  "--env-file",
  "--credential",
  "--server",
  "-s",
  "--cwd",
  "-c",
];

/**
 * The `--env`/`--env-file`/`--credential`/`--server` suffix — a leading-space
 * string, or empty — that reproduces an invocation's environment selection,
 * appended to a `zitadel` command a run suggests so the retry resolves the
 * same server, project and credential instead of silently falling back to the
 * default environment and quietly targeting the wrong project.
 *
 * This is the single source for the suffix format. {@link
 * import("./environment-command").EnvironmentCommand.environmentSelector}
 * derives these arguments from its resolved environment; a command that only
 * reads the raw flags (e.g. `doctor`, which is not an `EnvironmentCommand` but
 * still honours `--env`/`--env-file`) passes them straight through. Only a
 * value that actually came from a flag is reproduced — `--env` and `--env-file`
 * are mutually exclusive, and `--server` can accompany either; an inherited
 * value needs no flag because the next run in the same environment inherits it.
 * `--credential` goes with them because without it the next run chooses its
 * credential by the default order, which the flag overrode.
 */
export function environmentSelectorSuffix(input: {
  /** `--cwd` as typed: the project the run was about. */
  cwd?: string;
  /** `--env-file` as typed, relative to the shell's directory; see {@link projectEnvFile}. */
  envFile?: string;
  envName?: string;
  /** `--credential` as typed. */
  credential?: string;
  server?: string;
}): EnvironmentSelector {
  const parts: string[] = [];
  if (input.envFile !== undefined) {
    parts.push(Cmd.option("--env-file", input.envFile));
  } else if (input.envName !== undefined) {
    parts.push(Cmd.option("--env", input.envName));
  }
  if (input.credential !== undefined) {
    parts.push(Cmd.option("--credential", input.credential));
  }
  if (input.server !== undefined) {
    parts.push(Cmd.option("--server", input.server));
  }
  // Last, as the least interesting part to read; flag order does not matter.
  if (input.cwd !== undefined) {
    parts.push(Cmd.option("--cwd", input.cwd));
  }
  return asEnvironmentSelector(parts.length === 0 ? "" : ` ${parts.join(" ")}`);
}

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
