import { join } from "node:path";

import consola from "consola";

import { ZitadelError } from "../errors";
import { publicCliCommand } from "../public-cli";
import type { ResolvedEnv } from "./env-vars";
import { assertDockerAvailable, startFailure } from "./internal/failures";
import { BinaryLauncher, type StopBinaryRuntimeResult } from "./internal/binary-launcher";
import { DockerLauncher, type DockerResult } from "./internal/docker-launcher";
import { Lifecycle, type Launcher, type LifecycleOptions } from "./internal/lifecycle";
import { HttpHealth, TcpPorts } from "./internal/probes";
import { withStartLock } from "./internal/start-lock";
import { RuntimeFileStore } from "./internal/store";
import { discoverManagedRuntimeProcesses, type ManagedRuntimeProcess } from "./processes";
import {
  type BinaryRuntimeMetadata,
  type DockerRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
  checkLocalServerHealth,
  ensureContainerIdentity,
  localContainerName,
  localRuntimePaths,
  readRuntimeMetadata,
  removeLocalData,
  removeRuntimeMetadata,
} from "./runtime";

/** What to run when starting: everything a server needs that the directory does not already say. */
export type RunConfig = Readonly<{
  backend: RuntimeBackend;
  /** The Docker image, for the Docker backend. */
  image?: string;
  /** Project variables for the server's environment. */
  env: ResolvedEnv;
  /** Bootstrap user document for the local admin. */
  userFile?: string;
}>;

export type ServerStatus = Readonly<{
  lifecycle: "missing" | "running" | "unhealthy" | "stopped";
  runtime: RuntimeMetadata | undefined;
  healthy: boolean;
  /** The recorded process, for the binary backend. */
  process?: { pid: number; running: boolean };
  docker: {
    available: boolean;
    error?: string;
    container_exists: boolean;
    container_running: boolean;
  };
}>;

export type StopReport = Readonly<{
  runtime: RuntimeMetadata | undefined;
  /** False when there was nothing to stop: no record, or the process was already gone. */
  stopped: boolean;
  /** How the process was stopped, for the binary backend. */
  outcome?: StopBinaryRuntimeResult;
}>;

export type SweepResult = Readonly<
  | { supported: false; error?: string }
  | {
      supported: true;
      results: ReadonlyArray<{
        process: ManagedRuntimeProcess;
        stop_result: StopBinaryRuntimeResult;
      }>;
    }
>;

/**
 * The local server of one directory. A directory has at most one, running as a
 * process or as a container, and `.zitadel/local/runtime.json` records which. It
 * is the only way the commands start, stop, inspect or read the logs of it: how
 * a server is run, which port it gets and how it is stopped stay behind it.
 */
export class LocalServer {
  private readonly cwd: string;
  private readonly cliVersion: string;

  private constructor(cwd: string, cliVersion: string) {
    this.cwd = cwd;
    this.cliVersion = cliVersion;
  }

  static at(cwd: string, options: { cliVersion: string }): LocalServer {
    return new LocalServer(cwd, options.cliVersion);
  }

  /** The server version this CLI ships, for comparing with a running server's. */
  static bundledVersion(): string | undefined {
    return BinaryLauncher.bundledVersion();
  }

  /** The bundled server version, or the error that says how to repair the install. */
  static assertBinaryAvailable(): string {
    return BinaryLauncher.assertAvailable();
  }

  static dockerReachable(): Promise<DockerResult> {
    return DockerLauncher.available();
  }

  static imageAvailable(image: string): Promise<"local" | "remote"> {
    return DockerLauncher.imageAvailable(image);
  }

  /** Stops every CLI-managed server process on the machine, whichever directory started it. */
  static async stopAll(): Promise<SweepResult> {
    const discovery = await discoverManagedRuntimeProcesses();
    if (!discovery.supported) {
      return { supported: false, error: discovery.error };
    }
    const results: Array<{ process: ManagedRuntimeProcess; stop_result: StopBinaryRuntimeResult }> =
      [];
    for (const processInfo of discovery.processes) {
      results.push({
        process: processInfo,
        stop_result: await BinaryLauncher.stopPid(processInfo.pid),
      });
    }
    if (results.some((result) => result.stop_result.status === "failed")) {
      throw new ZitadelError("E_VALIDATION", "Some managed local runtime processes did not stop", {
        hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
        details: { supported: true, results },
      });
    }
    return { supported: true, results };
  }

  /**
   * Starts the directory's server, or finds it already running. A running one
   * is kept only when it is the version (binary) or image (Docker) asked for. The
   * directory keeps the port it had, takes the first free one otherwise, and an
   * explicit `port` is taken as asked or refused.
   */
  async start(
    config: RunConfig,
    options: { port?: number } = {},
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    // One start at a time per directory: two at once would pick the same port
    // and run two servers over one data directory. The second finds the first's.
    return withStartLock(join(localRuntimePaths(this.cwd).runtimeDir, "start.lock"), () =>
      this.startLocked(config, options),
    );
  }

  private async startLocked(
    config: RunConfig,
    options: { port?: number },
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    const existing = await readRuntimeMetadata(this.cwd);
    const paths = localRuntimePaths(this.cwd);
    try {
      if (config.backend === "binary") {
        // A server another CLI release started serves that release's API, and
        // `setup` against it fails halfway, after the project exists. So a
        // running server is reused only when it is the version this CLI ships;
        // the Docker backend compares the image for the same reason.
        const version = BinaryLauncher.bundledVersion();
        if (
          existing?.backend === "binary" &&
          version !== undefined &&
          existing.server_version !== version &&
          (await BinaryLauncher.isRecordRunning(existing))
        ) {
          consola.info(
            `Restarting the local Zitadel server on ${version}: it ran ${existing.server_version}. Its data stays.`,
          );
        }
        if (existing?.backend === "docker") {
          await DockerLauncher.remove(existing.container_name);
        }
        return await this.run<BinaryRuntimeMetadata>(
          "binary",
          new BinaryLauncher({
            cliVersion: this.cliVersion,
            dataDir: paths.dataDir,
            logPath: paths.logFile,
            env: config.env,
            userFile: config.userFile,
          }),
          {
            port: options.port,
            reusable: (record) => version === undefined || record.server_version === version,
          },
        );
      }

      const image = config.image;
      if (image === undefined) {
        throw new ZitadelError("E_VALIDATION", "The Docker backend needs an image", {});
      }
      await assertDockerAvailable(this.cliVersion);
      if (existing?.backend === "binary") {
        await BinaryLauncher.stopRecord(existing);
      }
      return await this.run<DockerRuntimeMetadata>(
        "docker",
        new DockerLauncher({
          cliVersion: this.cliVersion,
          containerName: localContainerName(this.cwd),
          image,
          dataDir: paths.dataDir,
          identity: await ensureContainerIdentity(this.cwd, DockerLauncher.currentUser()),
          env: config.env,
          userFile: config.userFile,
        }),
        { port: options.port, reusable: (record) => record.image === image },
      );
    } catch (error) {
      throw await startFailure(error, this.cliVersion);
    }
  }

  /** Where the directory's server stands: whether it is recorded, alive and answering. */
  async status(): Promise<ServerStatus> {
    const runtime = await readRuntimeMetadata(this.cwd);
    let container: Awaited<ReturnType<typeof DockerLauncher.inspect>> | undefined;
    let dockerError: string | undefined;
    if (runtime?.backend === "docker") {
      try {
        container = await DockerLauncher.inspect(runtime.container_name);
      } catch (error) {
        dockerError = error instanceof Error ? error.message : String(error);
      }
    }
    const healthy = runtime ? await checkLocalServerHealth(runtime.server_url) : false;
    const running =
      runtime?.backend === "binary" ? await BinaryLauncher.isRecordRunning(runtime) : false;
    return {
      lifecycle: lifecycleOf({ runtime, healthy, running, container }),
      runtime,
      healthy,
      ...(runtime?.backend === "binary" ? { process: { pid: runtime.pid, running } } : {}),
      docker: {
        available: dockerError === undefined,
        error: dockerError,
        container_exists: container?.exists ?? false,
        container_running: container?.running ?? false,
      },
    };
  }

  /** Stops the directory's server and keeps its data. */
  async stop(): Promise<StopReport> {
    return this.halt();
  }

  /** Stops the directory's server and deletes its data and its record. */
  async reset(): Promise<StopReport> {
    const report = await this.halt();
    await removeLocalData(this.cwd);
    await removeRuntimeMetadata(this.cwd);
    return report;
  }

  /** The end of the server's log, or the whole of it followed until interrupted. */
  async logs(options: {
    tail: number;
    follow?: boolean;
  }): Promise<{ runtime: RuntimeMetadata; logs: string }> {
    const runtime = await readRuntimeMetadata(this.cwd);
    if (!runtime) {
      throw new ZitadelError("E_VALIDATION", "Local Zitadel runtime has not been started", {
        hint: "Run `zitadel start` first.",
        nextCommands: [publicCliCommand("start", this.cliVersion)],
      });
    }
    if (options.follow) {
      if (runtime.backend === "binary") {
        await BinaryLauncher.followLogs(runtime.log_path, options.tail);
      } else {
        await DockerLauncher.followLogs(runtime.container_name, options.tail);
      }
      return { runtime, logs: "" };
    }
    const logs =
      runtime.backend === "binary"
        ? await BinaryLauncher.readLogs(runtime.log_path, options.tail)
        : await DockerLauncher.readLogs(runtime.container_name, options.tail);
    return { runtime, logs };
  }

  private async halt(): Promise<StopReport> {
    const runtime = await readRuntimeMetadata(this.cwd);
    if (runtime?.backend === "binary") {
      const outcome = await BinaryLauncher.stopRecord(runtime);
      if (outcome.status === "failed") {
        throw new ZitadelError("E_VALIDATION", "Local Zitadel server did not stop", {
          hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
          details: { runtime, stop_result: outcome },
        });
      }
      return { runtime, stopped: outcome.status !== "stale", outcome };
    }
    const removed = await DockerLauncher.remove(
      runtime?.backend === "docker" ? runtime.container_name : localContainerName(this.cwd),
    );
    return { runtime, stopped: removed };
  }

  private async run<R extends RuntimeMetadata>(
    backend: R["backend"],
    launcher: Launcher<R>,
    options: LifecycleOptions<R>,
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    const { record, alreadyRunning } = await new Lifecycle<R>(
      {
        store: new RuntimeFileStore<R>(this.cwd, backend),
        launcher,
        ports: new TcpPorts(),
        health: new HttpHealth(),
      },
      options,
    ).start();
    return { runtime: record, alreadyRunning };
  }
}

function lifecycleOf(input: {
  runtime: RuntimeMetadata | undefined;
  healthy: boolean;
  running: boolean;
  container: { exists: boolean; running: boolean } | undefined;
}): ServerStatus["lifecycle"] {
  if (!input.runtime) {
    return "missing";
  }
  if (input.runtime.backend === "binary") {
    if (input.running && input.healthy) {
      return "running";
    }
    return input.running ? "unhealthy" : "stopped";
  }
  if (input.container?.running && input.healthy) {
    return "running";
  }
  return input.container?.exists ? "unhealthy" : "stopped";
}
