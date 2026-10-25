import { join } from "node:path";

import consola from "consola";

import { ZitadelError } from "../errors";
import { unscopedCommand } from "../suggestion";
import type { ResolvedEnv } from "./env-vars";
import { assertDockerAvailable, startFailure } from "./internal/failures";
import { BinaryLauncher, type StopBinaryRuntimeResult } from "./internal/binary-launcher";
import { DockerLauncher, type DockerResult } from "./internal/docker-launcher";
import {
  Lifecycle,
  PortInUseError,
  type Launcher,
  type LifecycleOptions,
} from "./internal/lifecycle";
import { HttpHealth, TcpPorts } from "./internal/probes";
import { withStartLock } from "./internal/start-lock";
import { RuntimeFileStore } from "./internal/store";
import type { LocalServers, ManagedRuntimeProcess } from "./processes";
import {
  type RuntimeBackend,
  type RuntimeMetadata,
  checkLocalServerHealth,
  ensureContainerIdentity,
  localContainerName,
  localRuntimePaths,
  localServerNotRunning,
  readNearestRuntimeMetadata,
  readRuntimeMetadata,
  removeLocalData,
  removeRuntimeMetadata,
} from "./runtime";
import {
  type LogLevel,
  type LogLine,
  LogLineReader,
  type LogSink,
  atLeast,
  lastLines,
  logLines,
} from "./server-log";

/** What every backend needs to start: what the directory does not already say. */
type CommonRunConfig = Readonly<{
  /** Project variables for the server's environment. */
  env: ResolvedEnv;
  /** Bootstrap user document for the local admin. */
  userFile?: string;
}>;

/**
 * What to run when starting. A Docker server needs an image and a process does
 * not, so the two are separate shapes: a Docker config without an image cannot
 * be written, instead of failing when it is used.
 */
export type RunConfig =
  | (CommonRunConfig & Readonly<{ backend: "binary" }>)
  | (CommonRunConfig & Readonly<{ backend: "docker"; image: string }>);

/**
 * Where a directory's server stands. `missing`: the directory never started one
 * (no record). `stopped`: there is a record but what it names is not running.
 * `unhealthy`: it is running but does not answer. `running`: both. Whether
 * something answers at the recorded URL is not enough on its own, because
 * another directory's server may have taken the port since; see
 * {@link LocalServer.resolveUrl}.
 */
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

/**
 * The outcome of {@link LocalServer.stopAll}. `supported: false` where the
 * process list cannot be read (Windows, or no `ps`), so callers can say so
 * instead of reporting that nothing was running.
 */
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
 * The local server of one directory, and the only door to it.
 *
 * The rule this class keeps: every directory runs its own server, on its own
 * port, with its own data and its own admin credential, and the CLI only talks
 * to the server that directory's own `.zitadel/local/runtime.json` names. What
 * this replaced (issue #1863) was a second directory silently attaching to the
 * first one's server on port 8080 and signing in with a password that server
 * never imported. So nothing here falls back to a default port, and a recorded
 * URL is never trusted on its own: see {@link LocalServer.resolveUrl}.
 *
 * A directory has at most one server, a process (`binary`) or a container
 * (`docker`), and the record says which. The commands call this class and
 * nothing under `internal/`. How a server is launched, which port it gets, how
 * it is stopped and how it is told apart from another directory's all live
 * there. When behaviour is missing, add it here and to a launcher, not to a
 * command, or the commands drift apart again.
 */
export class LocalServer {
  private readonly cwd: string;
  private readonly cliVersion: string;

  private constructor(cwd: string, cliVersion: string) {
    this.cwd = cwd;
    this.cliVersion = cliVersion;
  }

  /**
   * The server of a directory. `cliVersion` is only used to word the commands
   * that errors suggest, so they name the CLI release the user is running.
   */
  static at(cwd: string, options: { cliVersion: string }): LocalServer {
    return new LocalServer(cwd, options.cliVersion);
  }

  /**
   * The server version this CLI ships. A server another CLI release started
   * serves that release's API, so `start` and `setup` compare it with a running
   * server's before reusing it. `undefined` when it cannot be read.
   */
  static bundledVersion(): string | undefined {
    return BinaryLauncher.bundledVersion();
  }

  /**
   * The bundled server version, or the error that says how to repair the
   * install. For `doctor`, which must report a broken install, not crash on it.
   */
  static assertBinaryAvailable(): string {
    return BinaryLauncher.assertAvailable();
  }

  /** Whether the Docker daemon answers, for `doctor` and for failing a Docker start early. */
  static dockerReachable(): Promise<DockerResult> {
    return DockerLauncher.available();
  }

  /** Where an image can be had from, so `doctor` can warn before a start has to pull it. */
  static imageAvailable(image: string): Promise<"local" | "remote"> {
    return DockerLauncher.imageAvailable(image);
  }

  /**
   * The URL of the server the nearest `zitadel start` record names, when that
   * server is the one running and answering.
   *
   * A URL alone is not enough. After a directory's server stops, another
   * directory's can take its port, and then "something answers at the recorded
   * URL" is true of the wrong server: the console would send this directory's
   * admin password there and `setup` would create projects in someone else's
   * data. So the record's own process or container must be the one running.
   * There is no fallback to a default port, for the same reason.
   *
   * The record is looked up from `cwd` upwards because `start` may have run in a
   * parent of the app directory.
   */
  static async resolveUrl(cwd: string): Promise<string> {
    const nearest = await readNearestRuntimeMetadata(cwd);
    if (!nearest) {
      throw localServerNotRunning();
    }
    if (await LocalServer.isServing(nearest.runtime)) {
      return nearest.runtime.server_url;
    }
    throw localServerNotRunning(nearest.runtime.server_url);
  }

  /**
   * {@link resolveUrl} for optional UI such as the setup wizard's server
   * choice: it never throws, and a malformed record or a server that is not
   * running yields `undefined` (`doctor` owns diagnosing those states).
   */
  static async detectUrl(cwd: string): Promise<string | undefined> {
    try {
      return await LocalServer.resolveUrl(cwd);
    } catch {
      return undefined;
    }
  }

  /** Whether the server a record names is running (see the identity checks in the launchers) and answering. */
  private static async isServing(runtime: RuntimeMetadata): Promise<boolean> {
    const alive =
      runtime.backend === "binary"
        ? await BinaryLauncher.isRecordRunning(runtime)
        : (await DockerLauncher.inspect(runtime.container_name).catch(() => undefined))?.running ===
          true;
    return alive && (await checkLocalServerHealth(runtime.server_url));
  }

  /**
   * Stops every CLI-managed server process on the machine, whichever directory
   * started it. It is the way out when a record is lost or wrong and `stop`
   * cannot find the server: the processes are found by their command lines, not
   * by any directory's record.
   */
  static async stopAll(servers: LocalServers): Promise<SweepResult> {
    const discovery = await servers.current();
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
   * Starts the directory's server, or finds it already running.
   *
   * A running server is kept only if it is what was asked for: the server
   * version this CLI ships (binary) or the same image (Docker). Otherwise it is
   * restarted on the same data.
   *
   * Port rules, each there for a reason. The directory keeps the port it had,
   * because the URLs `setup` wrote into the app's configuration name it. With no
   * record it takes the first free port from 8080, so a second directory never
   * competes for the first one's. A port passed as `options.port` is taken as
   * asked or refused, never moved, because a server where the caller did not
   * look for it is worse than an error. Whether a port is free is decided by
   * claiming it, not by listing sockets: see `TcpPorts`.
   *
   * Starts are serialised per directory by a lock, so two at once cannot run two
   * servers over one data directory; the second finds the first's. Failures are
   * mapped to the errors the commands report in `internal/failures.ts`.
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

  /**
   * The body of {@link start}, run while holding the directory's start lock.
   * Switching backends (container to process, or back) stops the other
   * backend's server to make way, but never for a port that cannot be had: a
   * refused move must leave the working server running, so the destination
   * port is checked before anything is torn down. The port the directory had is
   * carried over (`previousPort`) so a backend switch does not change its URLs.
   */
  private async startLocked(
    config: RunConfig,
    options: { port?: number },
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    const existing = await readRuntimeMetadata(this.cwd);
    const paths = localRuntimePaths(this.cwd);
    // The server another backend left. It is stopped to make way for this one,
    // but not for a port that cannot be had: a refused move leaves it running.
    const other = existing && existing.backend !== config.backend ? existing : undefined;
    try {
      if (
        other &&
        options.port !== undefined &&
        options.port !== other.port &&
        !(await new TcpPorts().isFree(options.port))
      ) {
        throw new PortInUseError(options.port);
      }
      if (config.backend === "binary") {
        // A server another CLI release started serves that release's API, and
        // `setup` against it fails halfway, after the project exists. So a
        // running server is reused only when it is the version this CLI ships;
        // the Docker backend compares the image for the same reason. `version` is
        // `undefined` only when the package cannot be read, and then any running
        // server is kept: there is nothing to compare with.
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
        return await this.run(
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
            previousPort: other?.port,
            reusable: (record) => version === undefined || record.server_version === version,
          },
        );
      }

      const { image } = config;
      await assertDockerAvailable(this.cliVersion);
      if (existing?.backend === "binary") {
        await BinaryLauncher.stopRecord(existing);
      }
      return await this.run(
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
        {
          port: options.port,
          previousPort: other?.port,
          reusable: (record) => record.image === image,
        },
      );
    } catch (error) {
      throw await startFailure(error, this.cliVersion);
    }
  }

  /**
   * Where the directory's server stands. It never throws for a server that is
   * down, a missing record or an unreachable Docker (that is the answer, and the
   * `docker` part says why), because `status` and `doctor` exist to report those
   * states. "Running" for a process means its recorded pid still belongs to the
   * server that was started, not merely that some process has that pid.
   */
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

  /**
   * Stops the directory's server and keeps its data. Idempotent: with nothing
   * recorded, or a recorded server that is already gone, it reports that
   * nothing was stopped instead of failing, so scripts can run it twice.
   */
  async stop(): Promise<StopReport> {
    return this.halt();
  }

  /**
   * Stops the directory's server and deletes its data and its record. The
   * server is stopped first so its database is not deleted from under it. The
   * local admin credential is kept: deleting it would leave a start that cannot
   * sign in, because the server only imports the admin once.
   */
  async reset(): Promise<StopReport> {
    const report = await this.halt();
    await removeLocalData(this.cwd);
    await removeRuntimeMetadata(this.cwd);
    return report;
  }

  /**
   * The end of the server's log: its last `tail` lines, or with `level` the
   * last `tail` lines at that level or above. The log is read by the record,
   * so it works for a server that has stopped, which is when the log is most
   * wanted.
   */
  async logs(options: {
    tail: number;
    level?: LogLevel;
  }): Promise<{ runtime: RuntimeMetadata; lines: LogLine[] }> {
    const runtime = await this.recordedRuntime();
    // Docker picks the last lines itself, but by count only, so lines at a
    // level are picked here from the whole log.
    const text =
      runtime.backend === "binary"
        ? await BinaryLauncher.readLog(runtime.log_path)
        : await DockerLauncher.readLogs(
            runtime.container_name,
            options.level ? "all" : options.tail,
          );
    return { runtime, lines: lastLines(logLines(text), options.tail, options.level) };
  }

  /**
   * Prints the end of the server's log, the lines {@link logs} picks, and then
   * each line the server writes, until interrupted. With `level`, the lines
   * below it are left out of both.
   */
  async followLogs(options: {
    tail: number;
    level?: LogLevel;
    print: (lines: readonly LogLine[]) => void;
  }): Promise<RuntimeMetadata> {
    const runtime = await this.recordedRuntime();
    const reader = new LogLineReader();
    const sink: LogSink = {
      existing: (text) => options.print(lastLines(reader.read(text), options.tail, options.level)),
      appended: (text) => options.print(atLeast(reader.read(text), options.level)),
    };
    if (runtime.backend === "binary") {
      await BinaryLauncher.followLogs(runtime.log_path, sink);
    } else {
      await DockerLauncher.followLogs(
        runtime.container_name,
        options.level ? "all" : options.tail,
        sink,
      );
    }
    options.print(atLeast(reader.end(), options.level));
    return runtime;
  }

  /** The directory's record, which reading the log needs: the log is found by it. */
  private async recordedRuntime(): Promise<RuntimeMetadata> {
    const runtime = await readRuntimeMetadata(this.cwd);
    if (!runtime) {
      throw new ZitadelError("E_VALIDATION", "Local Zitadel runtime has not been started", {
        hint: "Run `zitadel start` first.",
        nextCommands: [unscopedCommand("start", this.cliVersion)],
      });
    }
    return runtime;
  }

  /**
   * Stops what the record names. For a process, the whole process group is
   * signalled and a pid that is no longer the server is left alone (see
   * `BinaryLauncher.stopRecord`). For a container, or with no record at all, the
   * container named for this directory is removed if there is one: a start that
   * failed halfway can leave a container behind with no record of it. Where
   * Docker is not installed there is none, and that is not an error.
   */
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

  /**
   * Runs the lifecycle for one backend. The store is typed to that backend so a
   * record the other backend wrote reads as "nothing here": the other backend's
   * server is handled explicitly by {@link startLocked}, never by accident.
   */
  private async run<B extends RuntimeBackend>(
    backend: B,
    launcher: Launcher<Extract<RuntimeMetadata, { backend: B }>>,
    options: LifecycleOptions<Extract<RuntimeMetadata, { backend: B }>>,
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    const { record, alreadyRunning } = await new Lifecycle<
      Extract<RuntimeMetadata, { backend: B }>
    >(
      {
        store: new RuntimeFileStore(this.cwd, backend),
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
