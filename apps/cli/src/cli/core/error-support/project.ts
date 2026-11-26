import {
  ProjectConfigMissingError,
  ProjectEnvValueMultilineError,
  ProjectEnvValueUnquotableError,
  ProjectInvalidError,
  ProjectSecretMissingError,
} from "@/lib/project";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a project with no `zitadel.json` is refused. */
const CONFIG_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Set the project up first.",
  next: [
    {
      id: "setup",
    },
  ],
} as const satisfies Refusal;

/** How a project with no `.zitadel/secret` is refused. */
const SECRET_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
  next: [
    {
      id: "doctor",
      flags: {
        fix: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How a value a `.env` file cannot hold, because it has a line break, is refused. */
const ENV_VALUE_MULTILINE_REFUSAL = {
  message: "{message}",
  hint: "A .env value is a single line; remove the newline or store the value another way.",
} as const satisfies Refusal;

/** How a value no `.env` quoting reads back unchanged is refused. */
const ENV_VALUE_UNQUOTABLE_REFUSAL = {
  message: "{message}",
  hint: "Set it in the process environment instead of a .env file.",
} as const satisfies Refusal;

/** How a project file that cannot be used as it is is refused. */
const INVALID_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/project` are worded, most specific class first. */
export const PROJECT_WORDINGS: readonly Wording[] = [
  [ProjectConfigMissingError, CONFIG_MISSING_REFUSAL],
  [ProjectSecretMissingError, SECRET_MISSING_REFUSAL],
  [ProjectEnvValueMultilineError, ENV_VALUE_MULTILINE_REFUSAL],
  [ProjectEnvValueUnquotableError, ENV_VALUE_UNQUOTABLE_REFUSAL],
  [ProjectInvalidError, INVALID_REFUSAL],
];
