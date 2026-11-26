import {
  EnvironmentFileMissingError,
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueInvalidError,
  EnvironmentValueMissingError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";
import { LocalServerUrlInvalidError } from "@/lib/server";

import { CWD, type Row } from "./row";

/** The sources a production run consults, in order. */
const PRODUCTION_SOURCES = [
  "--server",
  "process environment",
  ".env.production.local",
  ".env.production",
] as const;

/** The sources a development run consults, in order. */
const DEVELOPMENT_SOURCES = [
  "--server",
  "process environment",
  ".env.development.local",
  ".env.local",
  ".zitadel/secret",
] as const;

/** The sources an `--env-file` run consults, in order. */
const ENV_FILE_SOURCES = ["--server", "--env-file ci.env", "process environment"] as const;

/** The address a source supplied that is not a server. */
const BAD_SERVER = "not a url";

/** The errors of `@/lib/environment`, each with what main showed for it. */
export const ENVIRONMENT_ROWS: readonly Row[] = [
  {
    error: new EnvironmentSourcesConflictError("--env and --env-file cannot be used together"),
    main: "lib/environment/environment.ts:91",
    expected: {
      code: "E_VALIDATION",
      message: "--env and --env-file cannot be used together",
      hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
      exitCode: 3,
    },
  },
  {
    error: new EnvironmentNameInvalidError("../prod is not a valid environment name", "--env"),
    main: "lib/environment/environment-name.ts:84",
    expected: {
      code: "E_VALIDATION",
      message: "../prod is not a valid environment name",
      hint: 'The --env environment name may use only letters, digits, dot, dash and underscore, may not contain "..", and may not be `local` or end in `.local`. Pass a safe --env or set ZITADEL_ENV.',
      exitCode: 3,
    },
  },
  {
    error: new EnvironmentFileMissingError("--env-file ci.env was not found"),
    main: "lib/environment/environment.ts:116",
    expected: {
      code: "E_VALIDATION",
      message: "--env-file ci.env was not found",
      exitCode: 3,
    },
  },
  {
    case: "an environment bound by env add",
    error: new EnvironmentValueMissingError(
      "ZITADEL_PROJECT_SECRET is not set for the production environment",
      {
        environment: "production",
        variable: "ZITADEL_PROJECT_SECRET",
        consulted: PRODUCTION_SOURCES,
        file: ".env.production.local",
      },
    ),
    main: "lib/environment/environment.ts:253",
    expected: {
      code: "E_VALIDATION",
      message: "ZITADEL_PROJECT_SECRET is not set for the production environment",
      hint: "Consulted, in order: --server, process environment, .env.production.local, .env.production. Set ZITADEL_PROJECT_SECRET in .env.production.local or the process environment.",
      details: {
        environment: "production",
        variable: "ZITADEL_PROJECT_SECRET",
        consulted: PRODUCTION_SOURCES,
      },
      exitCode: 3,
    },
  },
  {
    case: "a run that named its file with --env-file",
    error: new EnvironmentValueMissingError(
      "ZITADEL_PROJECT_SECRET is not set for the development environment",
      {
        environment: "development",
        variable: "ZITADEL_PROJECT_SECRET",
        consulted: ENV_FILE_SOURCES,
        file: "ci.env",
      },
    ),
    main: "lib/environment/environment.ts:253",
    expected: {
      code: "E_VALIDATION",
      message: "ZITADEL_PROJECT_SECRET is not set for the development environment",
      hint: "Consulted, in order: --server, --env-file ci.env, process environment. Set ZITADEL_PROJECT_SECRET in ci.env or the process environment.",
      details: {
        environment: "development",
        variable: "ZITADEL_PROJECT_SECRET",
        consulted: ENV_FILE_SOURCES,
      },
      exitCode: 3,
    },
  },
  {
    case: "a named environment with no project",
    error: new EnvironmentValueUnboundError(
      "ZITADEL_PROJECT_ID is not set for the production environment",
      {
        environment: "production",
        variable: "ZITADEL_PROJECT_ID",
        consulted: PRODUCTION_SOURCES,
        file: ".env.production.local",
      },
    ),
    main: "lib/environment/environment.ts:253",
    expected: {
      code: "E_VALIDATION",
      message: "ZITADEL_PROJECT_ID is not set for the production environment",
      hint: "Consulted, in order: --server, process environment, .env.production.local, .env.production. Set ZITADEL_PROJECT_ID in .env.production.local or the process environment, or run `zitadel env add production`.",
      details: {
        environment: "production",
        variable: "ZITADEL_PROJECT_ID",
        consulted: PRODUCTION_SOURCES,
      },
      next: [{ id: "env:add", args: { name: "production" }, flags: { cwd: CWD } }],
      exitCode: 3,
    },
  },
  {
    case: "the development environment with no project",
    error: new EnvironmentValueUnboundError(
      "ZITADEL_PROJECT_ID is not set for the development environment",
      {
        environment: "development",
        variable: "ZITADEL_PROJECT_ID",
        consulted: DEVELOPMENT_SOURCES,
        file: ".env.development.local",
      },
    ),
    main: "lib/environment/environment.ts:253",
    expected: {
      code: "E_VALIDATION",
      message: "ZITADEL_PROJECT_ID is not set for the development environment",
      hint: "Consulted, in order: --server, process environment, .env.development.local, .env.local, .zitadel/secret. Set ZITADEL_PROJECT_ID in .env.development.local or the process environment, or run `zitadel env add development`.",
      details: {
        environment: "development",
        variable: "ZITADEL_PROJECT_ID",
        consulted: DEVELOPMENT_SOURCES,
      },
      next: [{ id: "setup", flags: { cwd: CWD } }],
      exitCode: 3,
    },
  },
  {
    error: new EnvironmentValueInvalidError(
      `ZITADEL_URL from .env.production.local is not a valid server: ${BAD_SERVER}`,
      ".env.production.local",
      new LocalServerUrlInvalidError(`Invalid server "${BAD_SERVER}"`),
    ),
    main: "lib/environment/environment.ts:347",
    expected: {
      code: "E_VALIDATION",
      message: `ZITADEL_URL from .env.production.local is not a valid server: ${BAD_SERVER}`,
      hint: "Fix or remove ZITADEL_URL in .env.production.local; it must be a URL such as https://preview.zitadel.com.",
      details: {
        cause: `Invalid server "${BAD_SERVER}"`,
      },
      exitCode: 3,
    },
  },
];
