import { setTimeout as sleep } from "node:timers/promises";

import { Flags } from "@oclif/core";

import { ZitadelError, toZitadelError } from "../lib/errors";
import {
  binaryLogs,
  isProcessRunning,
  startBinaryRuntime,
  stopBinaryRuntime,
  type StopBinaryRuntimeResult,
} from "../lib/local-server/binary";
import {
  currentUser,
  dockerAvailable,
  ensureImage,
  inspectContainer,
  metadataFromStart,
  startContainer,
  stopAndRemoveContainer,
} from "../lib/local-server/docker";
import {
  dockerRuntimeGuidance,
  dockerUnavailableMessage,
} from "../lib/local-server/docker-guidance";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  checkLocalServerHealth,
  defaultLocalServerImageForCliVersion,
  ensureContainerIdentity,
  ensureLocalState,
  hasCurrentLaunchContract,
  localContainerName,
  localServerUrl,
  readRuntimeMetadata,
  writeRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { listenersForPort, type TcpListener } from "../lib/prober/ports";
import { publicCliCommand } from "../lib/public-cli";

const START_TIMEOUT_MS = 90_000;

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override flags = {
    image: Flags.string({ description: "Container image to run." }),
    port: Flags.integer({ description: "Local HTTP port.", default: DEFAULT_LOCAL_SERVER_PORT }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Start);
    const port = flags.port ?? DEFAULT_LOCAL_SERVER_PORT;
    const serverUrl = localServerUrl(port);
    await this.toMeta(flags, { resolveServer: false, source: serverUrl });

    validatePort(port);
    const runtimeBackend = resolveRuntimeBackend({
      image: flags.image,
      runtime: flags.runtime,
      envImage: this.meta.env.ZITADEL_LOCAL_IMAGE,
    });
    assertRuntimeFlags(runtimeBackend, flags.image);
    this.recordTelemetry({ runtime: runtimeBackend });
    const image =
      flags.image ??
      this.meta.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.meta.cliVersion);
    const containerName = localContainerName(this.meta.cwd);
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Local Zitadel server start plan.",
          runtime: {
            backend: runtimeBackend,
            ...(runtimeBackend === "docker"
              ? {
                  container_name: containerName,
                  image,
                }
              : {}),
            port,
          },
          urls: {
            api: serverUrl,
            console: `${serverUrl}/ui/console/`,
            login: `${serverUrl}/ui/login/`,
          },
          next_commands: [publicCliCommand("start", this.meta.cliVersion)],
        },
      });
    }

    const paths = await ensureLocalState(this.meta.cwd);
    const existingRuntime = await readRuntimeMetadata(this.meta.cwd);

    if (runtimeBackend === "binary") {
      // Healthy is not enough to reuse: a runtime launched by an older CLI
      // answers /healthz just fine while missing the environment this CLI
      // hands the server (the launch contract), and a running process cannot
      // pick that up. Such a runtime is restarted below, keeping its data dir.
      if (
        existingRuntime?.backend === "binary" &&
        existingRuntime.port === port &&
        hasCurrentLaunchContract(existingRuntime) &&
        isProcessRunning(existingRuntime.pid) &&
        (await checkLocalServerHealth(serverUrl))
      ) {
        await writeRuntimeMetadata(this.meta.cwd, existingRuntime);
        return this.emit({
          status: "ok",
          data: readyData(existingRuntime, true, this.meta.cliVersion),
        });
      }
      await stopExistingRuntime(existingRuntime);
      await assertPortAvailableForStart(port, serverUrl, this.meta.cliVersion);
      const metadata = await startBinaryRuntime({
        cliVersion: this.meta.cliVersion,
        dataDir: paths.dataDir,
        logPath: paths.logFile,
        port,
        serverUrl,
      });
      try {
        await waitForHealth(
          serverUrl,
          this.meta.cliVersion,
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
          throw startupCleanupFailedError(error, stopResult, this.meta.cliVersion);
        }
        throw error;
      }
      await writeRuntimeMetadata(this.meta.cwd, metadata);
      return this.emit({
        status: "ok",
        data: readyData(metadata, false, this.meta.cliVersion),
      });
    }

    await assertDockerAvailable(this.meta.cliVersion);
    if (existingRuntime?.backend === "binary") {
      await stopBinaryRuntime(existingRuntime.pid);
    }
    const existing = await inspectContainer(containerName);
    // Same rule as the binary runtime: a container that matches the image is
    // reused only when its runtime record shows it was created under the
    // current launch contract. A record from an older CLI, or none at all,
    // means the container's environment is unknown, so it is recreated on the
    // same data volume.
    if (
      existing.exists &&
      existing.running &&
      existing.image === image &&
      existingRuntime?.backend === "docker" &&
      hasCurrentLaunchContract(existingRuntime) &&
      (await checkLocalServerHealth(serverUrl))
    ) {
      const metadata = metadataFromStart({
        cwdDataDir: paths.dataDir,
        cliVersion: this.meta.cliVersion,
        containerName,
        containerId: existing.id ?? containerName,
        image,
        port,
        serverUrl,
      });
      await writeRuntimeMetadata(this.meta.cwd, metadata);
      return this.emit({
        status: "ok",
        data: readyData(metadata, true, this.meta.cliVersion),
      });
    }

    if (existing.exists) {
      await stopAndRemoveContainer(containerName);
    }

    await assertPortAvailableForStart(port, serverUrl, this.meta.cliVersion);
    await ensureImage(image);
    const containerId = await startContainer({
      containerName,
      image,
      port,
      dataDir: paths.dataDir,
      identity: await ensureContainerIdentity(this.meta.cwd, currentUser()),
    });
    await waitForHealth(serverUrl, this.meta.cliVersion, {
      runtime: "docker",
      container_name: containerName,
    });

    const metadata = metadataFromStart({
      cwdDataDir: paths.dataDir,
      cliVersion: this.meta.cliVersion,
      containerName,
      containerId,
      image,
      port,
      serverUrl,
    });
    await writeRuntimeMetadata(this.meta.cwd, metadata);
    return this.emit({
      status: "ok",
      data: readyData(metadata, false, this.meta.cliVersion),
    });
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

function readyData(
  metadata: RuntimeMetadata,
  alreadyRunning: boolean,
  cliVersion: string,
) {
  return {
    title: alreadyRunning
      ? "Local Zitadel server is already running."
      : "Local Zitadel server is ready.",
    runtime: {
      backend: metadata.backend,
      ...(metadata.backend === "docker"
        ? {
            container_name: metadata.container_name,
            container_id: metadata.container_id,
            image: metadata.image,
          }
        : {
            pid: metadata.pid,
            log_path: metadata.log_path,
            server_package: metadata.server_package,
            server_version: metadata.server_version,
          }),
      port: metadata.port,
      data_dir: metadata.data_dir,
    },
    urls: {
      api: metadata.server_url,
      console: `${metadata.server_url}/ui/console/`,
      login: `${metadata.server_url}/ui/login/`,
    },
    next_actions: [
      "From your app directory, run setup; the CLI will detect the framework or ask when needed.",
      "Setup installs dependencies when needed; then start your app dev server.",
    ],
    next_commands: [publicCliCommand("setup --server local", cliVersion)],
  };
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
  return new ZitadelError("E_NETWORK", "Local Zitadel server process exited before becoming healthy", {
    hint: "Inspect the local runtime logs, then retry after fixing the startup error.",
    nextCommands: [
      publicCliCommand("logs", cliVersion),
      publicCliCommand("reset --force", cliVersion),
    ],
    details: { ...details, server_url: serverUrl, ...(logTail ? { log_tail: logTail } : {}) },
  });
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ZitadelError("E_VALIDATION", `Invalid port ${String(port)}`, {
      hint: "Use a TCP port between 1 and 65535.",
    });
  }
}

function resolveRuntimeBackend(input: {
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

function assertRuntimeFlags(runtime: RuntimeBackend, image: string | undefined): void {
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
