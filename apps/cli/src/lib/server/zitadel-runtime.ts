import { join } from "node:path";

import { DEFAULT_SERVER } from "@zitadel/config/server";
import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError, errorMessage } from "@/lib/errors";
import { currentUser } from "@/lib/uidgid";

import {
  assertLocalStateWritable,
  atLeast,
  BinaryLauncher,
  checkLocalServerHealth,
  CONTAINER_DATA_DIR,
  DEFAULT_LOCAL_SERVER_PORT,
  DEFAULT_LOCAL_SERVER_URL,
  defaultLocalServerImageForCliVersion,
  type DestroyPermit,
  DockerLauncher,
  type DockerResult,
  DockerUnavailableError,
  EMPTY_SUMMARY,
  ensureContainerIdentity,
  ensureLocalAdmin,
  ensureLocalState,
  findLocalAdminDir,
  findLocalAdminFor,
  findUpward,
  HttpHealth,
  lastLines,
  type Launcher,
  Lifecycle,
  type LifecycleOptions,
  listenersForPort,
  loadProjectEnv,
  LOCAL_ADMIN_FILE,
  LOCAL_RUNTIME_DIR,
  LOCAL_RUNTIME_FILE,
  type LocalAdmin,
  localContainerName,
  localRuntimePaths,
  localServerNotRunning,
  type LocalServers,
  localServerUrl,
  LOG_LEVELS,
  type LogLevel,
  LogLineReader,
  LogLines,
  logLines,
  type LogSink,
  loopbackReach,
  type ManagedRuntimeProcess,
  peekRuntimeMetadata,
  PLATFORM_PROJECT_ID,
  PortInUseError,
  readLocalAdmin,
  readNearestRuntimeMetadata,
  readPlatformRuntime,
  readRuntimeMetadata,
  removeLocalData,
  removeRuntimeMetadata,
  type ResolvedEnv,
  resolveRuntimeBackend,
  RUNTIME_BACKENDS,
  type RuntimeBackend,
  RuntimeFileStore,
  type RuntimeMetadata,
  runtimeSummary,
  sameLocalServer,
  type StopBinaryRuntimeResult,
  TcpPorts,
  withStartLock,
  writeRuntimeMetadata,
} from "./local";
import { isLoopbackHost } from "./host";

/** What a runtime is, as telemetry and decisions bucket it. */
export type RuntimeKind = "cloud" | "local" | "self_hosted" | "unknown";

/**
 * The resolved target server plus the source it came from. `origin` is
 * retained (not just the value) so callers can report *why* a server was
 * chosen.
 */
export type ResolvedServer = {
  /** The server's address. */
  value: string;
  /** What named it: `--server`, the default, or the local server of the directory. */
  origin: "flag" | "default" | "local";
};

/**
 * Inputs to {@link ZitadelRuntime.resolve}. Passed explicitly (cwd) rather than read
 * from globals so resolution is pure and testable. `serverFlag` comes from the
 * parsed CLI invocation.
 */
export type ResolveServerInput = {
  /** The directory the run addresses, where `--server local` looks for a started server. */
  cwd: string;
  /** The value of `--server`, when it was given. */
  serverFlag?: string;
};

/**
 * The Zitadel runtime a command addresses: where Zitadel runs, on this machine or elsewhere,, and the one way into everything the
 * CLI knows about one: the default, the variable that names it, how a typed or
 * flagged value becomes an origin, and what a URL says about where it points.
 */
export abstract class ZitadelRuntime {
  /**
   * Server URL used when nothing else resolves (`@zitadel/config/server`, which
   * the console shares). Also surfaced in hints and the interactive setup
   * prompt as the suggested value.
   */
  static readonly DEFAULT: string = DEFAULT_SERVER;

  /** The runtime's address, as it was given. */
  readonly address: string;

  /**
   * @param address - The server's address, as it was given.
   */
  protected constructor(address: string) {
    this.address = address;
  }

  /**
   * A server known by its address, as a hint, a flag or a response names it.
   * An address alone is never a server the CLI manages, even on this machine:
   * only {@link LocalRuntime.forFolder} is, because only a folder says which
   * server it started.
   *
   * @param address - The server's address.
   * @returns A runtime the CLI can ask about and talk to.
   */
  static fromUrl(address: string): CloudRuntime {
    return new CloudRuntime(address);
  }

  /**
   * Resolves which server `setup` should create its project on: the `--server`
   * flag, else {@link ZitadelRuntime.DEFAULT}. Every other command takes its server
   * from `ZITADEL_URL` (see `Environment.resolve`), because a project belongs
   * to the server that created it and the default says nothing about that. A
   * flag value is validated to a normalised origin; an invalid URL throws a
   * `ZitadelError` rather than silently falling through.
   *
   * @param input - The project directory and the `--server` flag, when given.
   * @returns The server and where it came from.
   * @throws {ZitadelError} `E_VALIDATION` when the flag is not an http(s) URL,
   *   or the local server's own error when `local` is not running.
   */
  static async resolve(input: ResolveServerInput): Promise<ResolvedServer> {
    if (!input.serverFlag) {
      return { value: ZitadelRuntime.DEFAULT, origin: "default" };
    }
    if (input.serverFlag === "local") {
      return { value: await LocalRuntime.resolveUrl(input.cwd), origin: "local" };
    }
    return { value: ZitadelRuntime.origin(input.serverFlag), origin: "flag" };
  }

  /**
   * A typed or flagged server as its origin, or the problem with it: the
   * `parse` an input question takes, so a prompt re-asks instead of throwing
   * out of it.
   *
   * @param value - What was typed.
   * @returns The origin, or why the value is not a server.
   */
  static parse(value: string): Parsed<string> {
    const typed = value.trim();
    if (typed === "") {
      return {
        ok: false,
        problem: "The server URL cannot be empty",
      };
    }
    try {
      return {
        ok: true,
        value: ZitadelRuntime.origin(typed),
      };
    } catch (error) {
      return {
        ok: false,
        problem: errorMessage(error),
      };
    }
  }

  /**
   * Normalises a server URL to its origin.
   *
   * @param value - The server's address.
   * @returns The origin.
   * @throws {ZitadelError} `E_VALIDATION` when it is not an http(s) URL.
   */
  static origin(value: string): string {
    if (!URL.canParse(value)) {
      throw new ZitadelError("E_VALIDATION", `Invalid server "${value}"`, {
        hint: `Use a URL like ${ZitadelRuntime.DEFAULT}.`,
      });
    }
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ZitadelError("E_VALIDATION", `Server URL must use http(s): ${value}`, {
        hint: `Use a URL like ${ZitadelRuntime.DEFAULT}.`,
      });
    }
    return url.origin;
  }

  /**
   * Loopback check on the URL's hostname: `localhost`, the whole `127.0.0.0/8`
   * block, or `[::1]` (how WHATWG URLs spell IPv6 loopback).
   *
   * @returns `true` when it points at this machine.
   */
  isLoopback(): boolean {
    try {
      return isLoopbackHost(new URL(this.address).hostname);
    } catch {
      return false;
    }
  }

  /**
   * What kind of runtime this is, for a decision or an event that must not
   * carry the address: the hosted cloud, one on this machine, any other
   * server, or an address that is not a URL.
   */
  abstract get kind(): RuntimeKind;

  /**
   * Whether this is Zitadel's hosted cloud: the default server or a host under
   * `zitadel.cloud`.
   *
   * @returns `true` when the address is a hosted cloud's.
   */
  isCloud(): boolean {
    return this.kind === "cloud";
  }

  /**
   * Where this server's console is: `/console/` on the hosted cloud, which
   * serves it apart from the API, and `/ui/console/` on any other server.
   *
   * @returns The console's address, with its trailing slash.
   * @throws {ZitadelError} `E_VALIDATION` when the address is not an http(s) URL.
   */
  consoleUrl(): string {
    return `${ZitadelRuntime.origin(this.address)}${this.isCloud() ? "/console/" : "/ui/console/"}`;
  }

  /**
   * The host of a server, for an ending that says where a run happened, or
   * `undefined` for the default server, which a reader does not need told, and
   * for an address that is not a URL.
   *
   * @returns The host, or `undefined` when there is nothing to say.
   */
  hostUnlessDefault(): string | undefined {
    try {
      const { host } = new URL(this.address);
      return host === new URL(ZitadelRuntime.DEFAULT).host ? undefined : host;
    } catch {
      return undefined;
    }
  }
}

/**
 * A runtime the CLI only talks to, wherever it is: Zitadel's hosted cloud, a
 * server a team runs itself, or an address on this machine that no folder
 * started. It never starts or stops it.
 */
export class CloudRuntime extends ZitadelRuntime {
  /**
   * @returns `cloud` for Zitadel's hosted cloud (the default server or a host
   *   under `zitadel.cloud`), `local` for an address on this machine,
   *   `self_hosted` for any other server, `unknown` for an address that is not
   *   a URL.
   */
  get kind(): RuntimeKind {
    if (this.address === "mock") {
      return "local";
    }
    if (!URL.canParse(this.address)) {
      return "unknown";
    }
    const { hostname } = new URL(this.address);
    if (isLoopbackHost(hostname)) {
      return "local";
    }

    return hostname === new URL(ZitadelRuntime.DEFAULT).hostname ||
      hostname === "zitadel.cloud" ||
      hostname.endsWith(".zitadel.cloud")
      ? "cloud"
      : "self_hosted";
  }
}

/** What a local runtime belongs to and works through. */
export type LocalDirectory = Readonly<{
  /** The folder it belongs to. */
  cwd: string;
  /** The CLI release that starts it. */
  cliVersion: string;
  /** Where it says what it is doing. */
  progress: (message: string) => void;
  /** The Docker it asks about containers. */
  docker: DockerEngine;
  /** The processes it asks about servers it started. */
  processes: ServerProcesses;
}>;

/**
 * What a runtime asks of Docker once a server's record names a container. The
 * real one is `DockerLauncher`; a test passes its own, so nothing is patched.
 */
export type DockerEngine = Pick<
  typeof DockerLauncher,
  "available" | "followLogs" | "inspect" | "readLogs" | "remove"
>;

/**
 * What a runtime asks of the processes it started: whether a record still names
 * a running server, how to stop it, and how to read its log. The real one is
 * `BinaryLauncher`; a test passes its own.
 */
export type ServerProcesses = Pick<
  typeof BinaryLauncher,
  "followLogs" | "isRecordRunning" | "readLog" | "stopRecord"
>;

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

/** What a start is asked for, as a command's flags and shell give it. */
export type StartRequest = Readonly<{
  /** The port to take as asked; by default the folder keeps the one it had, or takes the first free one. */
  port?: number;
  /** The runtime asked for, or the one that fits the image and the folder's record. */
  backend?: RuntimeBackend;
  /** The container image asked for. */
  image?: string;
  /** The shell the run was given, which may name an image (`ZITADEL_LOCAL_IMAGE`) and the server's own variables. */
  shell: NodeJS.ProcessEnv;
}>;

/** What a start with Docker would do. */
export type DockerStart = Readonly<{
  backend: "docker";
  port: number;
  apiUrl: string;
  consoleUrl: string;
  image: string;
  containerName: string;
}>;

/** What a start with the CLI's own server binary would do; it has no image or container. */
export type BinaryStart = Readonly<{
  backend: "binary";
  port: number;
  apiUrl: string;
  consoleUrl: string;
}>;

/**
 * What a start would do, decided before it does it: the runtime and the port,
 * and for Docker the image and the container. It is a value; nothing is
 * started, created or written to make one.
 */
export type StartPlan = DockerStart | BinaryStart;

/** How {@link LocalRuntime.start} is asked to start. */
export type StartOptions = Readonly<{
  /** The port to take as asked or refuse, never move; the first free one when absent. */
  port?: number;
}>;

/**
 * Where a directory's server stands. `missing`: the directory never started one
 * (no record). `stopped`: there is a record but what it names is not running.
 * `unhealthy`: it is running but does not answer. `running`: both. Whether
 * something answers at the recorded URL is not enough on its own, because
 * another directory's server may have taken the port since; see
 * {@link LocalRuntime.resolveUrl}.
 */
export type ServerStatus = Readonly<{
  /** Where the server stands, as defined above. */
  lifecycle: "missing" | "running" | "unhealthy" | "stopped";
  /** What the directory recorded, or `undefined` when it never started one. */
  runtime: RuntimeMetadata | undefined;
  /** Whether the recorded address answers its readiness probe. */
  healthy: boolean;
  /** The recorded process, for the binary backend. */
  process?: { pid: number; running: boolean };
  /** What Docker says; the fields are false when it cannot be asked. */
  docker: {
    /** Whether the Docker daemon answered. */
    available: boolean;
    /** Why it did not answer. */
    error?: string;
    /** Whether the recorded container exists. */
    container_exists: boolean;
    /** Whether it is running. */
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
 * The outcome of {@link LocalRuntime.stopAll}. `supported: false` where the
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
 * to the server that directory's own `.zitadel/local/runtime.json` names. A
 * second directory never silently attaches to another's server on port 8080
 * and signs in with a password that server never imported, so nothing here
 * falls back to a default port, and a recorded URL is never trusted on its own:
 * see {@link LocalRuntime.resolveUrl}.
 *
 * A directory has at most one server, a process (`binary`) or a container
 * (`docker`), and the record says which. The commands call this class and
 * nothing under `internal/`. How a server is launched, which port it gets, how
 * it is stopped and how it is told apart from another directory's all live
 * there. When behaviour is missing, add it here and to a launcher, not to a
 * command, or the commands drift apart again.
 */
export class LocalRuntime extends ZitadelRuntime {
  /** The processes listening on a TCP port of this machine, for naming what holds one. */
  static readonly listenersOn = listenersForPort;

  /** The address a local server answers on when nothing names another. */
  static readonly DEFAULT_URL: string = DEFAULT_LOCAL_SERVER_URL;

  /** The port a local server asks for first. */
  static readonly DEFAULT_PORT: number = DEFAULT_LOCAL_SERVER_PORT;

  /** The directory, from a project's root, that holds everything a local server keeps. */
  static readonly DIR: string = LOCAL_RUNTIME_DIR;

  /** The record of the server started in a directory, from the project's root. */
  static readonly FILE: string = LOCAL_RUNTIME_FILE;

  /** Where a container keeps the data directory it is given. */
  static readonly CONTAINER_DATA_DIR: string = CONTAINER_DATA_DIR;

  /** The project a local server hosts its own console under. */
  static readonly PLATFORM_PROJECT_ID: string = PLATFORM_PROJECT_ID;

  /** The runtimes `--runtime` names. */
  static readonly BACKENDS: typeof RUNTIME_BACKENDS = RUNTIME_BACKENDS;

  /** The record in `cwd`, or `undefined` when none was written there. */
  static readonly read = readRuntimeMetadata;

  /** The record in `cwd` read without recovering a malformed one. */
  static readonly peek = peekRuntimeMetadata;

  /** The record in `cwd` or the nearest parent that has one, and where it was found. */
  static readonly readNearest = readNearestRuntimeMetadata;

  /** The directory, from `cwd` upward, that holds `file`. */
  static readonly findUpward = findUpward;

  /** Where everything a local server keeps for `cwd` lives. */
  static readonly paths = localRuntimePaths;

  /** The name of the container a server in `cwd` runs as. */
  static readonly containerName = localContainerName;

  /** The address a local server on `port` answers on. */
  static readonly urlOf = localServerUrl;

  /** The image that goes with a CLI release. */
  static readonly imageFor = defaultLocalServerImageForCliVersion;

  /** The runtime a run asks for, or the one this machine can run. */
  static readonly resolveBackend = resolveRuntimeBackend;

  /** Creates the directories a local server keeps its state in. */
  static readonly ensureState = ensureLocalState;

  /** Whether the state directories can be written, and why not. */
  static readonly assertWritable = assertLocalStateWritable;

  /** What a record reports about itself, for a command's output. */
  static readonly summary = runtimeSummary;

  /** Whether two addresses name the same local server. */
  static readonly same = sameLocalServer;

  /** How the server at an address reaches this machine's loopback, judged by the nearest record. */
  static readonly loopbackReach = loopbackReach;

  /** The platform document a server publishes, or `undefined` when it hosts no platform project. */
  static readonly readPlatform = readPlatformRuntime;

  /** Writes the record of a directory; the lifecycle does this, and tests arrange one by it. */
  static readonly write = writeRuntimeMetadata;

  /** Whether the server at an address answers its readiness probe. */
  static readonly isHealthy = checkLocalServerHealth;

  /** Where the admin's credential is kept, from a project's root. */
  static readonly ADMIN_FILE: string = LOCAL_ADMIN_FILE;

  /** The directory holding the admin: `cwd`, or the nearest parent a server was started in. */
  static readonly findAdminDir = findLocalAdminDir;

  /** The nearest admin, from `cwd` upward, of the server at an address. */
  static readonly findAdminFor = findLocalAdminFor;

  /** The admin in a directory, or `undefined` when none was created. */
  static readonly readAdmin = readLocalAdmin;

  /** What a start that injected no project variables reports. */
  static readonly NO_ENV: typeof EMPTY_SUMMARY = EMPTY_SUMMARY;

  /** Reads the project's env files and the defaults a local server needs. */
  static readonly loadProjectEnv = loadProjectEnv;

  /** The levels a log line can have, from the most verbose. */
  static readonly LOG_LEVELS: typeof LOG_LEVELS = LOG_LEVELS;

  private readonly directory: LocalDirectory;

  /**
   * Use {@link LocalRuntime.forFolder}.
   *
   * @param address - The address the server answers on.
   * @param directory - The folder it belongs to and everything it works through.
   */
  constructor(address: string, directory: LocalDirectory) {
    super(address);
    this.directory = directory;
  }

  /** The runtime a local server always is. */
  get kind(): RuntimeKind {
    return "local";
  }

  /**
   * The server of a directory. `cliVersion` names the release the user is
   * running, which the server it launches matches. The commands its failures
   * suggest are rendered by the run that reports them, so they carry the
   * `--cwd` the run was given.
   *
   * @param cwd - The directory the server belongs to.
   * @param options - The CLI release that starts it, where to say what is happening (nowhere by default), and the Docker and processes it works through (the real ones by default).
   * @returns The directory's local runtime.
   */
  static forFolder(
    cwd: string,
    options: {
      cliVersion: string;
      progress?: (message: string) => void;
      docker?: DockerEngine;
      processes?: ServerProcesses;
    },
  ): LocalRuntime {
    return new LocalRuntime(LocalRuntime.DEFAULT_URL, {
      cwd,
      cliVersion: options.cliVersion,
      docker: options.docker ?? DockerLauncher,
      processes: options.processes ?? BinaryLauncher,
      progress:
        options.progress ??
        (() => {
          return;
        }),
    });
  }

  /** The directory this runtime belongs to. */
  private get cwd(): string {
    return this.directory.cwd;
  }

  /** The CLI release that starts this runtime. */
  private get cliVersion(): string {
    return this.directory.cliVersion;
  }

  /**
   * The server version this CLI ships. A server another CLI release started
   * serves that release's API, so `start` and `setup` compare it with a running
   * server's before reusing it. `undefined` when it cannot be read.
   *
   * @returns The version, or `undefined` when it cannot be read.
   */
  static bundledVersion(): string | undefined {
    return BinaryLauncher.bundledVersion();
  }

  /**
   * The bundled server version, or the error that says how to repair the
   * install. For `doctor`, which must report a broken install, not crash on it.
   *
   * @returns The bundled server version.
   * @throws {ZitadelError} When the install is broken, naming how to repair it.
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
   *
   * @param cwd - The directory the run addresses.
   * @returns The address of the server running there.
   * @throws {ZitadelError} When no server was started there, or the recorded one is not running.
   */
  static async resolveUrl(cwd: string): Promise<string> {
    const nearest = await readNearestRuntimeMetadata(cwd);
    if (!nearest) {
      throw localServerNotRunning();
    }
    if (await LocalRuntime.isServing(nearest.runtime)) {
      return nearest.runtime.server_url;
    }
    throw localServerNotRunning(nearest.runtime.server_url);
  }

  /**
   * {@link resolveUrl} for optional UI such as the setup wizard's server
   * choice: it never throws, and a malformed record or a server that is not
   * running yields `undefined` (`doctor` owns diagnosing those states).
   *
   * @param cwd - The directory the run addresses.
   * @returns The address, or `undefined` when no server is running there.
   */
  static async detectUrl(cwd: string): Promise<string | undefined> {
    try {
      return await LocalRuntime.resolveUrl(cwd);
    } catch {
      return undefined;
    }
  }

  /** Whether the server a record names is running (see the identity checks in the launchers) and answering. */
  private static async isServing(runtime: RuntimeMetadata): Promise<boolean> {
    const alive =
      runtime.backend === "binary"
        ? await BinaryLauncher.isRecordRunning(runtime)
        : (
            await DockerLauncher.inspect(runtime.container_name).catch(() => {
              return undefined;
            })
          )?.running === true;
    return alive && (await checkLocalServerHealth(runtime.server_url));
  }

  /**
   * Stops every CLI-managed server process on the machine, whichever directory
   * started it. It is the way out when a record is lost or wrong and `stop`
   * cannot find the server: the processes are found by their command lines, not
   * by any directory's record.
   *
   * @param servers - The processes of this machine.
   * @returns What was stopped, or that the processes cannot be listed here.
   * @throws {ZitadelError} When a process did not stop.
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
    if (
      results.some((result) => {
        return result.stop_result.status === "failed";
      })
    ) {
      throw new ZitadelError("E_VALIDATION", "Some managed local runtime processes did not stop", {
        hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
        details: { supported: true, results },
      });
    }
    return { supported: true, results };
  }

  /**
   * Creates the directory's local admin on first use and writes the bootstrap
   * user document a start hands the server ({@link ensureLocalAdmin}).
   *
   * It holds the directory's start lock while it does: a second start in the
   * directory would otherwise read the credential while the first is still
   * writing it, and report a file that is fine a moment later as malformed.
   *
   * @param builtinSchemaBase - The server's `schema.builtin_public_base`, when the environment overrides it.
   * @returns The credential, and the document's path for `--user-file`.
   */
  ensureAdmin(builtinSchemaBase?: string): Promise<{ admin: LocalAdmin; userFile: string }> {
    return withStartLock(this.startLockFile(), () => {
      return ensureLocalAdmin(this.cwd, builtinSchemaBase);
    });
  }

  /** The file that makes a start the only one in the directory. */
  private startLockFile(): string {
    return join(localRuntimePaths(this.cwd).runtimeDir, "start.lock");
  }

  /**
   * What this folder recorded about the server started in it.
   *
   * @returns The record, or `undefined` when the folder never started one.
   */
  record(): Promise<RuntimeMetadata | undefined> {
    return readRuntimeMetadata(this.cwd);
  }

  /**
   * The name a Docker container for this folder has.
   *
   * @returns The container's name.
   */
  containerName(): string {
    return localContainerName(this.cwd);
  }

  /**
   * Where this folder keeps the server's data.
   *
   * @returns The data directory.
   */
  dataDirectory(): string {
    return localRuntimePaths(this.cwd).dataDir;
  }

  /**
   * Where this folder keeps the local admin's sign-in.
   *
   * @returns The credential's path.
   */
  adminFile(): string {
    return join(this.cwd, LOCAL_ADMIN_FILE);
  }

  /**
   * The local admin `start` created in this folder.
   *
   * @returns The admin, or `undefined` when none was created.
   */
  admin(): Promise<LocalAdmin | undefined> {
    return readLocalAdmin(this.cwd);
  }

  /**
   * The address of this folder's server when it is the one running and
   * answering. A recorded address alone is not enough: another folder's server
   * may have taken the port since.
   *
   * @returns The address.
   * @throws {ZitadelError} When no server was started here, or the recorded one is not running.
   */
  runningUrl(): Promise<string> {
    return LocalRuntime.resolveUrl(this.cwd);
  }

  /**
   * The address this folder's server answers on: the one it recorded when it
   * was started, or the default one when it never was.
   *
   * @returns The address.
   */
  async url(): Promise<string> {
    const recorded = await readRuntimeMetadata(this.cwd);
    if (recorded === undefined) {
      return LocalRuntime.DEFAULT_URL;
    } else {
      return recorded.server_url;
    }
  }

  /**
   * The server of the closest folder, `cwd` or a parent, where `start` was run.
   * `start` often runs in a parent of the app, so commands that only read a
   * server look upward instead of acting on the folder they are in.
   *
   * @param cwd - Where to start looking.
   * @param options - The CLI release that would start it.
   * @returns That folder's server, or `undefined` when no folder above started one.
   */
  static async findStartedFrom(
    cwd: string,
    options: {
      cliVersion: string;
      progress?: (message: string) => void;
      docker?: DockerEngine;
      processes?: ServerProcesses;
    },
  ): Promise<LocalRuntime | undefined> {
    const nearest = await readNearestRuntimeMetadata(cwd);
    if (nearest === undefined) {
      return undefined;
    } else {
      return LocalRuntime.forFolder(nearest.dir, options);
    }
  }

  /**
   * What a start would do for this folder, without doing it: the port it keeps
   * or takes, the runtime and image that fit the request and the folder's
   * record, and the container's name.
   *
   * @param request - What the command was asked for.
   * @returns The plan.
   */
  async plan(request: StartRequest): Promise<StartPlan> {
    const recorded = await peekRuntimeMetadata(this.cwd);
    const envImage = request.shell.ZITADEL_LOCAL_IMAGE;
    const backend = resolveRuntimeBackend({
      image: request.image,
      runtime: request.backend,
      envImage,
    });
    const port = request.port ?? recorded?.port ?? DEFAULT_LOCAL_SERVER_PORT;

    if (backend === "docker") {
      return {
        backend: "docker",
        port,
        apiUrl: localServerUrl(port),
        consoleUrl: `${localServerUrl(port)}/ui/console/`,
        image: request.image ?? envImage ?? defaultLocalServerImageForCliVersion(this.cliVersion),
        containerName: localContainerName(this.cwd),
      };
    } else {
      return {
        backend: "binary",
        port,
        apiUrl: localServerUrl(port),
        consoleUrl: `${localServerUrl(port)}/ui/console/`,
      };
    }
  }

  /**
   * Starts the folder's server as {@link plan} says, or finds it already
   * running: creates the state directories, reads the project's `NEXTGEN_*`
   * variables before any runtime is stopped, creates the local admin the
   * platform bootstrap needs, and launches.
   *
   * The developer exists on their own server from the first start: the server
   * imports the local admin, and the console signs them in by link. The admin is
   * a user of the platform project, so the two travel together. A caller that
   * opts out of the platform bootstrap (a test harness wanting a bare
   * single-project server) gets neither. The opt-out is read from the merged
   * environment the server receives, the project's env files over the shell, so
   * a `false` in `.env.local` turns both off. A server pinned to a project of
   * its own cannot also bootstrap the platform one (it refuses that combination
   * at startup), so the pin wins and there is no admin.
   *
   * @param request - What the command was asked for.
   * @returns The server's record, and whether it was already running.
   * @throws {DockerUnavailableError} When a Docker start is asked for and Docker does not answer.
   */
  async launch(
    request: StartRequest,
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    const plan = await this.plan(request);
    await ensureLocalState(this.cwd);
    const env = await loadProjectEnv(this.cwd, request.shell);
    const serverEnv = { ...request.shell, ...env.values };
    const pinned = serverEnv.NEXTGEN_PLATFORM_PROJECT_ID;
    const bootstraps =
      (serverEnv.NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT ?? "true").toLowerCase() !== "false" &&
      (!pinned || pinned === PLATFORM_PROJECT_ID);
    const options = { port: request.port };

    if (bootstraps) {
      const { userFile } = await this.ensureAdmin(serverEnv.NEXTGEN_SCHEMA_BUILTIN_PUBLIC_BASE);
      if (plan.backend === "docker") {
        return this.start({ backend: "docker", image: plan.image, env, userFile }, options);
      } else {
        return this.start({ backend: "binary", env, userFile }, options);
      }
    } else {
      if (plan.backend === "docker") {
        return this.start({ backend: "docker", image: plan.image, env }, options);
      } else {
        return this.start({ backend: "binary", env }, options);
      }
    }
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
    options: StartOptions,
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    // One start at a time per directory: two at once would pick the same port
    // and run two servers over one data directory. The second finds the first's.
    return withStartLock(this.startLockFile(), () => {
      return this.startLocked(config, options);
    });
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
    options: StartOptions,
  ): Promise<{ runtime: RuntimeMetadata; alreadyRunning: boolean }> {
    const existing = await readRuntimeMetadata(this.cwd);
    const paths = localRuntimePaths(this.cwd);
    // The server another backend left. It is stopped to make way for this one,
    // but not for a port that cannot be had: a refused move leaves it running.
    const other = existing && existing.backend !== config.backend ? existing : undefined;
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
        (await this.directory.processes.isRecordRunning(existing))
      ) {
        this.directory.progress(
          `Restarting the local Zitadel server on ${version}: it ran ${existing.server_version}. Its data stays.`,
        );
      }
      if (existing?.backend === "docker") {
        await this.directory.docker.remove(existing.container_name);
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
          reusable: (record) => {
            return version === undefined || record.server_version === version;
          },
        },
      );
    }

    const { image } = config;
    const docker = await this.directory.docker.available().catch((error: unknown) => {
      throw new DockerUnavailableError(error);
    });
    if (docker.status !== 0) {
      throw new DockerUnavailableError(docker.stderr || "docker version failed");
    }
    if (existing?.backend === "binary") {
      await this.directory.processes.stopRecord(existing);
    }
    return await this.run(
      "docker",
      new DockerLauncher({
        cliVersion: this.cliVersion,
        containerName: localContainerName(this.cwd),
        image,
        dataDir: paths.dataDir,
        identity: await ensureContainerIdentity(this.cwd, currentUser()),
        env: config.env,
        userFile: config.userFile,
      }),
      {
        port: options.port,
        previousPort: other?.port,
        reusable: (record) => {
          return record.image === image;
        },
      },
    );
  }

  /**
   * Where the directory's server stands. It never throws for a server that is
   * down, a missing record or an unreachable Docker (that is the answer, and the
   * `docker` part says why), because `status` and `doctor` exist to report those
   * states. "Running" for a process means its recorded pid still belongs to the
   * server that was started, not merely that some process has that pid.
   *
   * @returns The status.
   */
  async status(): Promise<ServerStatus> {
    const runtime = await readRuntimeMetadata(this.cwd);
    const { container, dockerError } =
      runtime?.backend === "docker"
        ? await this.directory.docker.inspect(runtime.container_name).then(
            (inspected) => {
              return { container: inspected, dockerError: undefined };
            },
            (error: unknown) => {
              return { container: undefined, dockerError: errorMessage(error) };
            },
          )
        : { container: undefined, dockerError: undefined };
    const healthy = runtime ? await checkLocalServerHealth(runtime.server_url) : false;
    const running =
      runtime?.backend === "binary"
        ? await this.directory.processes.isRecordRunning(runtime)
        : false;
    // A process is up when its recorded pid still belongs to the server; a container
    // when Docker says it runs. Either way, up and answering is `running`, up and
    // silent is `unhealthy`, and a container that exists but is down is `unhealthy` too.
    const up = runtime?.backend === "binary" ? running : container?.running === true;
    const present = runtime?.backend === "binary" ? running : container?.exists === true;
    const lifecycle: ServerStatus["lifecycle"] = !runtime
      ? "missing"
      : up && healthy
        ? "running"
        : present
          ? "unhealthy"
          : "stopped";
    return {
      lifecycle,
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
   * sign in, because the server only imports the admin once. The data cannot
   * be recovered, so it takes a permit for exactly this folder.
   *
   * @param permit - The caller's proof that deleting is meant.
   * @returns What stopping the server did.
   * @throws {Error} When the permit is for another folder.
   */
  async reset(permit: DestroyPermit): Promise<StopReport> {
    if (permit.folder !== this.cwd) {
      throw new Error(`The permit is for ${permit.folder}, not ${this.cwd}`);
    }
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
  }): Promise<{ runtime: RuntimeMetadata; lines: LogLines }> {
    const runtime = await this.recordedRuntime();
    // Docker picks the last lines itself, but by count only, so lines at a
    // level are picked here from the whole log.
    const text =
      runtime.backend === "binary"
        ? await this.directory.processes.readLog(runtime.log_path)
        : await this.directory.docker.readLogs(
            runtime.container_name,
            options.level ? "all" : options.tail,
          );
    return { runtime, lines: new LogLines(lastLines(logLines(text), options.tail, options.level)) };
  }

  /**
   * Prints the end of the server's log, the lines {@link logs} picks, and then
   * each line the server writes, until interrupted. With `level`, the lines
   * below it are left out of both.
   */
  async follow(options: {
    tail: number;
    level?: LogLevel;
    print: (lines: LogLines) => void;
    /** The run's Ctrl-C: once it aborts, following stops, even before it began. */
    signal: AbortSignal;
  }): Promise<RuntimeMetadata> {
    const runtime = await this.recordedRuntime();
    const reader = new LogLineReader();
    const sink: LogSink = {
      existing: (text) =>
        options.print(new LogLines(lastLines(reader.read(text), options.tail, options.level))),
      appended: (text) => options.print(new LogLines(atLeast(reader.read(text), options.level))),
    };
    if (runtime.backend === "binary") {
      await this.directory.processes.followLogs(runtime.log_path, sink, { signal: options.signal });
    } else {
      await this.directory.docker.followLogs(
        runtime.container_name,
        options.level ? "all" : options.tail,
        sink,
        options.signal,
      );
    }
    options.print(new LogLines(atLeast(reader.end(), options.level)));
    return runtime;
  }

  /** The directory's record, which reading the log needs: the log is found by it. */
  private async recordedRuntime(): Promise<RuntimeMetadata> {
    const runtime = await readRuntimeMetadata(this.cwd);
    if (!runtime) {
      throw new ZitadelError("E_VALIDATION", "Local Zitadel runtime has not been started", {
        hint: "Run `zitadel start` first.",
        nextCommands: [{ id: "start" }],
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
      const outcome = await this.directory.processes.stopRecord(runtime);
      if (outcome.status === "failed") {
        throw new ZitadelError("E_VALIDATION", "Local Zitadel server did not stop", {
          hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
          details: { runtime, stop_result: outcome },
        });
      }
      return { runtime, stopped: outcome.status !== "stale", outcome };
    }
    const removed = await this.directory.docker.remove(
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
