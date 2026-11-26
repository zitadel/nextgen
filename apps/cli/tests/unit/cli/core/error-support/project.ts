import { FsNotFoundError } from "@/lib/fs";
import {
  ProjectConfigMissingError,
  ProjectEnvValueMultilineError,
  ProjectEnvValueUnquotableError,
  ProjectInvalidError,
  ProjectSecretMissingError,
} from "@/lib/project";

import type { Row } from "./row";

/** What `JSON.parse` says of a `zitadel.json` that is not JSON. */
const SYNTAX_MESSAGE = `Unexpected token 'x', "x" is not valid JSON`;

/** What reading a secret that lacks a field is refused with. */
const FIELDS_MISSING = ".zitadel/secret is missing required fields";

/** The errors of `@/lib/project`, each with what main showed for it. */
export const PROJECT_ROWS: readonly Row[] = [
  {
    error: new ProjectConfigMissingError(
      "zitadel.json was not found",
      new FsNotFoundError("Cannot read /work/app/zitadel.json"),
    ),
    main: "lib/project/project-config.ts:52",
    expected: {
      code: "E_VALIDATION",
      message: "zitadel.json was not found",
      hint: "Set the project up first.",
      next: [{ id: "setup" }],
      exitCode: 3,
    },
  },
  {
    error: new ProjectSecretMissingError(
      ".zitadel/secret was not found",
      new FsNotFoundError("Cannot read /work/app/.zitadel/secret"),
    ),
    main: "lib/project/project-secret.ts:103",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/secret was not found",
      hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
      next: [{ id: "doctor", flags: { fix: true } }],
      exitCode: 3,
    },
  },
  {
    case: "a zitadel.json that is not JSON",
    error: new ProjectInvalidError(SYNTAX_MESSAGE, new SyntaxError(SYNTAX_MESSAGE)),
    main: "lib/project/project-config.ts:48",
    expected: {
      code: "E_VALIDATION",
      message: SYNTAX_MESSAGE,
      details: {
        original: { name: "SyntaxError", message: SYNTAX_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a secret that is not a JSON object",
    error: new ProjectInvalidError(".zitadel/secret must contain a JSON object"),
    main: "lib/json.ts:89",
    expected: {
      code: "E_VALIDATION",
      message: ".zitadel/secret must contain a JSON object",
      details: {
        original: { name: "Error", message: ".zitadel/secret must contain a JSON object" },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main threw a plain Error with no class of its own; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: {
            name: "ProjectInvalidError",
            message: ".zitadel/secret must contain a JSON object",
          },
        },
      },
    },
  },
  {
    case: "a secret that lacks a field",
    error: new ProjectInvalidError(FIELDS_MISSING),
    main: "lib/project/project-secret.ts:89",
    expected: {
      code: "E_VALIDATION",
      message: FIELDS_MISSING,
      details: {
        original: { name: "Error", message: FIELDS_MISSING },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main threw a plain Error with no class of its own; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: { name: "ProjectInvalidError", message: FIELDS_MISSING },
        },
      },
    },
  },
  {
    error: new ProjectEnvValueMultilineError(
      "Cannot persist ZITADEL_PROJECT_SECRET: its value contains a line break.",
    ),
    main: "lib/project/env-file.ts:68",
    expected: {
      code: "E_VALIDATION",
      message: "Cannot persist ZITADEL_PROJECT_SECRET: its value contains a line break.",
      hint: "A .env value is a single line; remove the newline or store the value another way.",
      exitCode: 3,
    },
  },
  {
    error: new ProjectEnvValueUnquotableError(
      "Cannot persist ZITADEL_PROJECT_SECRET: no .env quoting reads its value back unchanged.",
    ),
    main: "lib/project/env-file.ts:92",
    expected: {
      code: "E_VALIDATION",
      message:
        "Cannot persist ZITADEL_PROJECT_SECRET: no .env quoting reads its value back unchanged.",
      hint: "Set it in the process environment instead of a .env file.",
      exitCode: 3,
    },
  },
];
