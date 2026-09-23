import { setTimeout as sleep } from "node:timers/promises";

import consola from "consola";

import { ZitadelError, toZitadelError } from "../errors";
import { publicCliCommand } from "../public-cli";
import { listenersForPort, type TcpListener } from "../prober/ports";
import { ensureLocalAdmin, type LocalAdmin } from "./admin-credential";
import {
  binaryLogs,
  isProcessRunning,
  startBinaryRuntime,
  stopBinaryRuntime,
  type StopBinaryRuntimeResult,
} from "./binary";
import {
  currentUser,
  dockerAvailable,
  ensureImage,
  inspectContainer,
  metadataFromStart,
  startContainer,
  stopAndRemoveContainer,
} from "./docker";
import { dockerRuntimeGuidance, dockerUnavailableMessage } from "./docker-guidance";
import { loadProjectEnv } from "./env-vars";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  PLATFORM_PROJECT_ID,
  checkLocalServerHealth,
  ensureContainerIdentity,
  ensureLocalState,
  readRuntimeMetadata,
  writeRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "./runtime";
import { consoleSignInUrl } from "./sign-in";

const START_TIMEOUT_MS = 90_000;

/**
 * The local admin the server was booted with, as the caller reports it: the
 * one-time console sign-in link when it could be minted, otherwise why not.
 */
export type ConsoleLogin = {
  signed_in_as: string;
  sign_in_url?: string;
  error?: string;
  hint?: string;
};

export type LaunchLocalServerInput = {
  cwd: string;
  /** The process environment; merged under the project's own env files. */
  env: NodeJS.ProcessEnv;
  cliVersion: string;
  backend: RuntimeBackend;
  containerName: string;
  /** Only read by the docker backend. */
  image: string;
  port: number;
  serverUrl: string;
};

export type LocalServerLaunch = {
  metadata: RuntimeMetadata;
  /** The runtime was already up and healthy, so this call adopted it. */
  alreadyRunning: boolean;
  console?: ConsoleLogin;
};

/**
 * Boots (or adopts) the managed local Zitadel server and records its runtime
 * metadata, returning what the caller needs to report it.
 *
 * Shared by `zitadel start` and the `zitadel run` dev loop, which is why it
 * lives here rather than in the command: the two must boot servers that are
 * indistinguishable, down to the runtime file `stop`, `logs`, and `status`
 * read afterwards.
 */
export async function launchLocalServer(
  input: LaunchLocalServerInput,
): Promise<LocalServerLaunch> {
  const paths = await ensureLocalState(input.cwd);
  const existingRuntime = await readRuntimeMetadata(input.cwd);
  // NEXTGEN_* variables from .env.local and .env are read before any runtime
  // is stopped and reach the new runtime through its environment only; see
  // env-vars.ts.
  const env = await loadProjectEnv(input.cwd);
  // The developer exists on their own server from the first start: the
  // server imports the local admin, and the console signs them in by link.
  // The admin is a user of the platform project, so the two travel together:
  // a caller that opts out of the platform bootstrap (a test harness wanting
  // a bare single-project server) gets neither. The opt-out is read from the
  // same merged environment the server receives — the project's env files
  // over the shell — so a `false` in `.env.local` turns both off rather than
  // being overridden by the user file forcing the bootstrap back on.
  const serverEnv = { ...input.env, ...env.values };
  const local = platformBootstrapEnabled(serverEnv)
    ? await ensureLocalAdmin(input.cwd, serverEnv.NEXTGEN_SCHEMA_BUILTIN_PUBLIC_BASE)
    : undefined;

  if (input.backend === "binary") {
    if (
      existingRuntime?.backend === "binary" &&
      existingRuntime.port === input.port &&
      isProcessRunning(existingRuntime.pid) &&
      (await checkLocalServerHealth(input.serverUrl))
    ) {
      await writeRuntimeMetadata(input.cwd, existingRuntime);
      return {
        metadata: existingRuntime,
        alreadyRunning: true,
        console: await consoleLoginFor(input.serverUrl, local?.admin),
      };
    }
    await stopExistingRuntime(existingRuntime);
    await assertPortAvailableForStart(input.port, input.serverUrl, input.cliVersion);
    const metadata = await startBinaryRuntime({
      cliVersion: input.cliVersion,
      dataDir: paths.dataDir,
      logPath: paths.logFile,
      port: input.port,
      serverUrl: input.serverUrl,
      env,
      userFile: local?.userFile,
    });
    try {
      await waitForHealth(
        input.serverUrl,
        input.cliVersion,
        {
          runtime: "binary",
          pid: metadata.pid,
          log_path: metadata.log_path,
        },
        {
          pid: metadata.pid,
          logPath: metadata.log_path,
        },
      );
    } catch (error) {
      const stopResult = await stopBinaryRuntime(metadata.pid);
      if (stopResult.status === "failed") {
        throw startupCleanupFailedError(error, stopResult, input.cliVersion);
      }
      throw error;
    }
    await writeRuntimeMetadata(input.cwd, metadata);
    return {
      metadata,
      alreadyRunning: false,
      console: await consoleLoginFor(input.serverUrl, local?.admin),
    };
  }

  await assertDockerAvailable(input.cliVersion);
  if (existingRuntime?.backend === "binary") {
    await stopBinaryRuntime(existingRuntime.pid);
  }
  const existing = await inspectContainer(input.containerName);
  if (
    existing.exists &&
    existing.running &&
    existing.image === input.image &&
    (await checkLocalServerHealth(input.serverUrl))
  ) {
    const metadata = metadataFromStart({
      cwdDataDir: paths.dataDir,
      cliVersion: input.cliVersion,
      containerName: input.containerName,
      containerId: existing.id ?? input.containerName,
      image: input.image,
      port: input.port,
      serverUrl: input.serverUrl,
      // The container was started with whatever was recorded then.
      env: existingRuntime?.backend === "docker" ? existingRuntime.env : undefined,
    });
    await writeRuntimeMetadata(input.cwd, metadata);
    return {
      metadata,
      alreadyRunning: true,
      console: await consoleLoginFor(input.serverUrl, local?.admin),
    };
  }

  if (existing.exists) {
    await stopAndRemoveContainer(input.containerName);
  }

  await assertPortAvailableForStart(input.port, input.serverUrl, input.cliVersion);
  await ensureImage(input.image);
  const { containerId, env: containerEnv } = await startContainer({
    containerName: input.containerName,
    image: input.image,
    port: input.port,
    dataDir: paths.dataDir,
    identity: await ensureContainerIdentity(input.cwd, currentUser()),
    env,
    userFile: local?.userFile,
  });
  await waitForHealth(input.serverUrl, input.cliVersion, {
    runtime: "docker",
    container_name: input.containerName,
  });

  const metadata = metadataFromStart({
    cwdDataDir: paths.dataDir,
    cliVersion: input.cliVersion,
    containerName: input.containerName,
    containerId,
    image: input.image,
    port: input.port,
    serverUrl: input.serverUrl,
    env: containerEnv,
  });
  await writeRuntimeMetadata(input.cwd, metadata);
  return {
    metadata,
    alreadyRunning: false,
    console: await consoleLoginFor(input.serverUrl, local?.admin),
  };
}

/**
 * Stops a runtime this process launched, whichever backend it runs on.
 * Unlike `zitadel stop` this reports rather than throws: the `run` loop stops
 * the server to start it again, and a stubborn process is something the next
 * start surfaces with its own remediation.
 */
export async function stopLocalServer(runtime: RuntimeMetadata): Promise<void> {
  if (runtime.backend === "binary") {
    await stopBinaryRuntime(runtime.pid);
    return;
  }
  await stopAndRemoveContainer(runtime.container_name);
}

/**
 * Whether this start boots the platform project, and with it the local admin.
 * On by default; an explicit `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false` opts
 * out, which is how a harness asks for a bare single-project instance.
 */
function platformBootstrapEnabled(env: NodeJS.ProcessEnv): boolean {
  if ((env.NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT ?? "true").toLowerCase() === "false") {
    return false;
  }
  // A server pinned to a project of its own cannot also bootstrap the platform
  // one — it refuses that combination at startup (cmd/server/config.go) — so the
  // pin wins and there is no local admin, rather than a start that cannot boot.
  const pinned = env.NEXTGEN_PLATFORM_PROJECT_ID;
  return !pinned || pinned === PLATFORM_PROJECT_ID;
}

/**
 * Mints a console sign-in link for the local admin. A failure (for
 * example a data directory from before the local admin existed) must not fail
 * the start itself, so it degrades to a warning with the fix. Without a local
 * admin there is nothing to sign in as, and the result carries no console.
 */
async function consoleLoginFor(
  serverUrl: string,
  admin: LocalAdmin | undefined,
): Promise<ConsoleLogin | undefined> {
  if (!admin) {
    return undefined;
  }
  try {
    const url = await consoleSignInUrl(serverUrl, admin);
    consola.log(`Console: signed in as ${admin.email}. Open this link (works once):`);
    consola.log(url);
    return { signed_in_as: admin.email, sign_in_url: url };
  } catch (error) {
    const reason = toZitadelError(error);
    consola.warn(`Could not create a console sign-in link: ${reason.message}`);
    return { signed_in_as: admin.email, error: reason.message, hint: reason.hint };
  }
}

function startupCleanupFailedError(
  error: unknown,
  stopResult: StopBinaryRuntimeResult,
  cliVersion: string,
): ZitadelError {
  const startupError = toZitadelError(error);
  return new ZitadelError(
    startupError.code,
    `${startupError.message}; cleanup did not stop the spawned local runtime`,
    {
      hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
      nextCommands: unique([
        ...(startupError.nextCommands ?? []),
        publicCliCommand("stop --all", cliVersion),
        publicCliCommand("logs", cliVersion),
        publicCliCommand("reset --force", cliVersion),
      ]),
      details: {
        startup_error: {
          code: startupError.code,
          message: startupError.message,
          details: startupError.details,
        },
        stop_result: stopResult,
      },
    },
  );
}

async function assertDockerAvailable(cliVersion: string): Promise<void> {
  let result: Awaited<ReturnType<typeof dockerAvailable>>;
  try {
    result = await dockerAvailable();
  } catch (error) {
    throw dockerUnavailableError(error, cliVersion);
  }
  if (result.status !== 0) {
    throw dockerUnavailableError(result.stderr || "docker version failed", cliVersion);
  }
}

function dockerUnavailableError(error: unknown, cliVersion: string): ZitadelError {
  const advice = dockerRuntimeGuidance("start", cliVersion);
  return new ZitadelError("E_VALIDATION", "Docker is not reachable", {
    hint: advice.hint,
    nextCommands: advice.nextCommands,
    details: { message: dockerUnavailableMessage(error) },
  });
}

async function waitForHealth(
  serverUrl: string,
  cliVersion: string,
  details: Record<string, unknown>,
  runtime?: { logPath?: string; pid?: number },
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (runtime?.pid && !isProcessRunning(runtime.pid)) {
      throw await serverExitedError(serverUrl, cliVersion, details, runtime.logPath);
    }
    if (await checkLocalServerHealth(serverUrl, 1000)) {
      return;
    }
    await sleep(1000);
  }
  throw new ZitadelError("E_NETWORK", "Local Zitadel server did not become healthy", {
    hint: "Inspect the local runtime logs, then reset the local runtime if needed.",
    nextCommands: [
      publicCliCommand("logs", cliVersion),
      publicCliCommand("reset --force", cliVersion),
    ],
    details: { ...details, server_url: serverUrl },
  });
}

async function assertPortAvailableForStart(
  port: number,
  serverUrl: string,
  cliVersion: string,
): Promise<void> {
  const listeners = await listenersForPort(port);
  if (listeners.length === 0) {
    return;
  }
  throw portInUseError(port, serverUrl, listeners, cliVersion);
}

function portInUseError(
  port: number,
  serverUrl: string,
  listeners: ReadonlyArray<TcpListener>,
  cliVersion: string,
): ZitadelError {
  const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
  return new ZitadelError("E_PORT_IN_USE", `Port ${String(port)} is already in use`, {
    hint: `Stop the process using ${serverUrl}, run \`zitadel stop --all\` for managed local runtimes, or choose another port.`,
    nextCommands: [
      publicCliCommand("stop --all", cliVersion),
      publicCliCommand(`start --port ${String(fallbackPort)}`, cliVersion),
    ],
    details: { port, server_url: serverUrl, listeners },
  });
}

async function serverExitedError(
  serverUrl: string,
  cliVersion: string,
  details: Record<string, unknown>,
  logPath: string | undefined,
): Promise<ZitadelError> {
  const logTail = logPath ? await binaryLogs(logPath, 40) : undefined;
  return new ZitadelError(
    "E_NETWORK",
    "Local Zitadel server process exited before becoming healthy",
    {
      hint: "Inspect the local runtime logs, then retry after fixing the startup error.",
      nextCommands: [
        publicCliCommand("logs", cliVersion),
        publicCliCommand("reset --force", cliVersion),
      ],
      details: { ...details, server_url: serverUrl, ...(logTail ? { log_tail: logTail } : {}) },
    },
  );
}

/** Rejects a port number no TCP listener could ever bind. */
export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ZitadelError("E_VALIDATION", `Invalid port ${String(port)}`, {
      hint: "Use a TCP port between 1 and 65535.",
    });
  }
}

/**
 * The backend a start runs on: the explicit flag, else docker when an image
 * was named (by flag or `ZITADEL_LOCAL_IMAGE`), else the npm binary.
 */
export function resolveRuntimeBackend(input: {
  runtime: unknown;
  image: string | undefined;
  envImage: string | undefined;
}): RuntimeBackend {
  if (input.runtime === "binary" || input.runtime === "docker") {
    return input.runtime;
  }
  if (input.image || input.envImage) {
    return "docker";
  }
  return "binary";
}

/** An image only means something to the docker backend; naming both is a mistake. */
export function assertRuntimeFlags(runtime: RuntimeBackend, image: string | undefined): void {
  if (runtime === "binary" && image) {
    throw new ZitadelError("E_VALIDATION", "--image requires --runtime docker", {
      hint: "Use `zitadel start --runtime docker --image <tag>`, or omit --image for the npm binary runtime.",
    });
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function stopExistingRuntime(runtime: RuntimeMetadata | undefined): Promise<void> {
  if (!runtime) {
    return;
  }
  if (runtime.backend === "binary") {
    const stopResult = await stopBinaryRuntime(runtime.pid);
    if (stopResult.status === "failed") {
      throw new ZitadelError("E_VALIDATION", "Existing local Zitadel server did not stop", {
        hint: "Stop the existing local runtime manually, then rerun start.",
        details: { runtime, stop_result: stopResult },
      });
    }
    return;
  }
  await stopAndRemoveContainer(runtime.container_name);
}
