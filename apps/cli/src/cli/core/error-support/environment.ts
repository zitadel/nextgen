import { SERVER } from "@/constants";
import {
  EnvironmentFileMissingError,
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueInvalidError,
  EnvironmentValueMissingError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How an environment named by its name and by a file is refused. */
const SOURCES_CONFLICT_REFUSAL = {
  message: "{message}",
  hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
} as const satisfies Refusal;

/** How an environment name that cannot be used in a path is refused. */
const NAME_INVALID_REFUSAL = {
  message: "{message}",
  hint: 'The {source} environment name may use only letters, digits, dot, dash and underscore, may not contain "..", and may not be `local` or end in `.local`. Pass a safe --env or set ZITADEL_ENV.',
} as const satisfies Refusal;

/** How an `--env-file` that is not there is refused. */
const FILE_MISSING_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a source that names a server that is not an http(s) URL is refused. */
const VALUE_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix or remove ZITADEL_URL in {source}; it must be a URL such as {example}.",
  details: {
    cause: "{reason}",
  },
} as const satisfies Refusal;

/** How a value set in no source is refused when its environment has no project at all. */
const VALUE_UNBOUND_REFUSAL = {
  message: "{message}",
  hint: "Consulted, in order: {sources}. Set {variable} in {file} or the process environment, or run `zitadel env add {environment}`.",
  next: ["{next}"],
} as const satisfies Refusal;

/** How a value set in no source is refused. */
const VALUE_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Consulted, in order: {sources}. Set {variable} in {file} or the process environment.",
} as const satisfies Refusal;

/** How the errors of `@/lib/environment` are worded, most specific class first. */
export const ENVIRONMENT_WORDINGS: readonly Wording[] = [
  [EnvironmentSourcesConflictError, SOURCES_CONFLICT_REFUSAL],
  [EnvironmentNameInvalidError, NAME_INVALID_REFUSAL],
  [EnvironmentFileMissingError, FILE_MISSING_REFUSAL],
  derived(EnvironmentValueInvalidError, VALUE_INVALID_REFUSAL, () => {
    return {
      values: {
        example: SERVER,
      },
    };
  }),
  derived(EnvironmentValueUnboundError, VALUE_UNBOUND_REFUSAL, (error, cwd) => {
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
  derived(EnvironmentValueMissingError, VALUE_MISSING_REFUSAL, (error) => {
    return {
      values: {
        sources: error.consulted.join(", "),
      },
    };
  }),
];
