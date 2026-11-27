import {
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueMissingError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";

import { type Advice, derived, type Wording } from "./wording";

/** How an environment named by its name and by a file is refused. */
const SOURCES_CONFLICT_ADVICE = {
  hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
} as const satisfies Advice;

/** How an environment name that cannot be used in a path is refused. */
const NAME_INVALID_ADVICE = {
  hint: 'The {source} environment name may use only letters, digits, dot, dash and underscore, may not contain "..", and may not be `local` or end in `.local`. Pass a safe --env or set ZITADEL_ENV.',
  details: {},
} as const satisfies Advice;

/** How a value set in no source is refused when its environment has no project at all. */
const VALUE_UNBOUND_ADVICE = {
  hint: "Consulted, in order: {sources}. Set {variable} in {file} or the process environment, or run `zitadel env add {environment}`.",
  next: ["{next}"],
  details: {
    environment: "{environment}",
    variable: "{variable}",
    consulted: "{consulted}",
  },
} as const satisfies Advice;

/** How a value set in no source is refused. */
const VALUE_MISSING_ADVICE = {
  details: {
    environment: "{environment}",
    variable: "{variable}",
    consulted: "{consulted}",
  },
} as const satisfies Advice;

/** How the errors of `@/lib/environment` are advised on, each for exactly its class. */
export const ENVIRONMENT_WORDINGS: readonly Wording[] = [
  [EnvironmentSourcesConflictError, SOURCES_CONFLICT_ADVICE],
  [EnvironmentNameInvalidError, NAME_INVALID_ADVICE],
  derived(EnvironmentValueUnboundError, VALUE_UNBOUND_ADVICE, (error, cwd) => {
    // Run in the directory this run addressed, which need not be the
    // shell's: `setup` and `env add` both write their files there.
    const elsewhere =
      cwd === process.cwd()
        ? {}
        : {
            cwd,
          };
    return {
      values: {
        sources: error.consulted.join(", "),
      },
      next: {
        next:
          error.environment === "development"
            ? {
                id: "setup",
                flags: elsewhere,
              }
            : {
                id: "env:add",
                args: {
                  name: error.environment,
                },
                flags: elsewhere,
              },
      },
    };
  }),
  [EnvironmentValueMissingError, VALUE_MISSING_ADVICE],
];
