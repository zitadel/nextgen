import { setTimeout as sleep } from "node:timers/promises";

import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { isProcessRunning, startBinaryRuntime, stopBinaryRuntime } from "../lib/local-server/binary";
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
  localContainerName,
  localServerUrl,
  readRuntimeMetadata,
  writeRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
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
      if (
        existingRuntime?.backend === "binary" &&
        existingRuntime.port === port &&
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
      const metadata = await startBinaryRuntime({
        cliVersion: this.meta.cliVersion,
        dataDir: paths.dataDir,
        logPath: paths.logFile,
        port,
        serverUrl,
      });
      try {
        await waitForHealth(serverUrl, this.meta.cliVersion, {
          runtime: "binary",
          pid: metadata.pid,
          log_path: metadata.log_path,
        });
      } catch (error) {
        await stopBinaryRuntime(metadata.pid);
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
    if (
      existing.exists &&
      existing.running &&
      existing.image === image &&
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
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
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

async function stopExistingRuntime(runtime: RuntimeMetadata | undefined): Promise<void> {
  if (!runtime) {
    return;
  }
  if (runtime.backend === "binary") {
    await stopBinaryRuntime(runtime.pid);
    return;
  }
  if (!(await checkLocalServerHealth(runtime.server_url))) {
    return;
  }
  await stopAndRemoveContainer(runtime.container_name);
}
