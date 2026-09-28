import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";

import type { AppEnvTemplate } from "./app-env";

/**
 * The contract between `withZitadel()` (evaluated in the Playwright config
 * process) and the two executables it points webServer entries at. Options
 * travel as JSON in these env vars because a webServer command is a plain
 * string — there is no richer channel.
 */
export const SUPERVISOR_CONFIG_ENV = "ZITADEL_TESTING_SUPERVISOR";
export const APP_RUNNER_CONFIG_ENV = "ZITADEL_TESTING_APP_RUNNER";
/** Read by the executables and the Playwright fixtures alike. */
export const HANDSHAKE_ENV = "ZITADEL_TESTING_HANDSHAKE";

export interface SupervisorConfig {
  /** Fixed port: the config process must know the health URL up front. */
  port: number;
  appOrigins?: string[];
  serverBinary?: string;
  /** Appended to the missing-binary error, e.g. how to build it. */
  serverBinaryHint?: string;
  dir?: string;
  keep?: boolean;
  projectName?: string;
  preset?: SetupPreset;
  useCase?: SetupUseCase;
  timeoutMs?: number;
}

export interface AppRunnerConfig {
  /** Spawn argv; executed without a shell. */
  command: string[];
  cwd?: string;
  env?: AppEnvTemplate;
  handshakeTimeoutMs?: number;
}

export function parseSupervisorConfig(raw: string | undefined): SupervisorConfig {
  const value = parseJsonEnv(raw, SUPERVISOR_CONFIG_ENV) as Partial<SupervisorConfig>;
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port <= 0) {
    throw new Error(`${SUPERVISOR_CONFIG_ENV} must carry a positive integer "port"`);
  }
  return value as SupervisorConfig;
}

export function parseAppRunnerConfig(raw: string | undefined): AppRunnerConfig {
  const value = parseJsonEnv(raw, APP_RUNNER_CONFIG_ENV) as Partial<AppRunnerConfig>;
  if (
    !Array.isArray(value.command) ||
    value.command.length === 0 ||
    value.command.some((part) => typeof part !== "string" || part.length === 0)
  ) {
    throw new Error(`${APP_RUNNER_CONFIG_ENV} must carry a non-empty string[] "command"`);
  }
  return value as AppRunnerConfig;
}

export function requireHandshakePath(env: NodeJS.ProcessEnv): string {
  const path = env[HANDSHAKE_ENV];
  if (!path) {
    throw new Error(
      `${HANDSHAKE_ENV} is not set. These entry points are meant to be launched ` +
        `by the webServer entries that withZitadel() generates.`,
    );
  }
  return path;
}

function parseJsonEnv(raw: string | undefined, name: string): unknown {
  if (!raw) {
    throw new Error(
      `${name} is not set. This entry point is meant to be launched by the ` +
        `webServer entries that withZitadel() generates.`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} contains invalid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
