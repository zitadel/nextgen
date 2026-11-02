import { execFile, spawn } from "node:child_process";
import { type FileHandle, mkdir, open, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { resolveServerBinary, serverBinaryPath } from "@zitadel/server/binary";

import { ZitadelError, errorMessage, isErrno } from "../../errors";
import { shellCommand } from "../../suggestion";
import { EMPTY_ENV, type ResolvedEnv, envSummary } from "../env-vars";
import type { BinaryRuntimeMetadata } from "../runtime";
import type { LogSink } from "../server-log";
import { type Clock, realClock, stopSignal } from "./clock";
import { type Launched, type Launcher, launched } from "./lifecycle";

export const SERVER_NPM_PACKAGE = "@zitadel/server";
const COMMAND_ENV = "ZITADEL_SERVER_BINARY";
const COMMAND_VERSION_ENV = "ZITADEL_SERVER_BINARY_VERSION";
const STOP_TIMEOUT_MS = 10_000;
const STOP_KILL_TIMEOUT_MS = 2_000;
/** How often a followed log file is checked for new lines. */
const LOG_POLL_MS = 1_000;
const MIGRATE_FLAG = "--migrate";
/** What the server binary is called, whatever launched it. */
const SERVER_PROGRAM = "nextgen";

const require = createRequire(import.meta.url);

export type BinaryLaunchSpec = Readonly<{
  cliVersion: string;
  dataDir: string;
  logPath: string;
  /** Project variables for the child's environment, never its argv. */
  env?: ResolvedEnv;
  /** Bootstrap user document for the local admin, passed as `--user-file`. */
  userFile?: string;
}>;

export type StopBinaryRuntimeResult = Readonly<{
  pid: number;
  signal?: NodeJS.Signals;
  status: "failed" | "stale" | "stopped";
  target: "process" | "process-group";
}>;

export type ServerCommand = Readonly<{
  command: string;
  args: string[];
  serverPackage: string;
  serverVersion: string;
}>;

/**
 * Everything about running the server as a local process: which binary, how it
 * is started, whether it is alive, how it is stopped and where it logs. The
 * binary comes from `@zitadel/server`, which owns the list of platforms; the CLI
 * starts it directly, not through that package's wrapper script, so the pid it
 * records is the pid that holds the port.
 *
 * The pid in a record is not proof of anything on its own, and most of this
 * class is about that. Pids are reused (after a reboot the recorded one can be
 * any program), every directory's server runs the same program, and a launcher
 * that was killed can leave the server running without the process the record
 * names. So "is this record's server running" asks three things: some process
 * in the recorded group is alive, it runs the server program, and it serves
 * *this record's* data directory, which is what tells one directory's server
 * from another's. Stopping applies the same test first, so a stale record can
 * never signal an unrelated program.
 */
export class BinaryLauncher implements Launcher<BinaryRuntimeMetadata> {
  private readonly spec: BinaryLaunchSpec;

  constructor(spec: BinaryLaunchSpec) {
    this.spec = spec;
  }

  /**
   * Starts the server as a detached process and returns the record that identifies it.
   *
   * The binary is started directly, not through `@zitadel/server`'s wrapper script:
   * the pid recorded is then the pid that holds the port, so stopping it stops the
   * server and a wrapper that dies cannot leave the server running unrecorded.
   * It is detached (its own process group and session) so it outlives this CLI
   * invocation, and its output goes to the log file, which is how `zitadel logs`
   * reads a server that is no longer running. Project variables reach it through
   * its environment, never its arguments, so they do not show up in `ps`.
   */
  async launch(target: {
    port: number;
    serverUrl: string;
  }): Promise<Launched<BinaryRuntimeMetadata>> {
    const { spec } = this;
    const command = BinaryLauncher.available(() => BinaryLauncher.command());
    const env = spec.env ?? EMPTY_ENV;
    await mkdir(dirname(spec.logPath), { recursive: true, mode: 0o700 });
    const log = await open(spec.logPath, "a", 0o600);
    try {
      const args = withMigrateFlag([
        ...command.args,
        ...(spec.userFile ? ["--user-file", spec.userFile] : []),
      ]);
      const child = spawn(command.command, args, {
        detached: true,
        // On Windows a detached process otherwise opens a console window.
        windowsHide: true,
        env: {
          ...process.env,
          // Declared project variables ride the child's environment, never argv.
          ...env.values,
          NEXTGEN_SERVER_ADDRESS: `:${String(target.port)}`,
          NEXTGEN_SERVER_DATA_DIR: spec.dataDir,
          // Browser-facing URLs (claim, dashboard) must point at this local
          // server, not the cloud default the server config falls back to.
          NEXTGEN_SERVER_PUBLIC_BASE: target.serverUrl,
          // The platform project and the local admin travel together: the admin
          // is a user of it. The caller decides by passing a user file, and an
          // opted-out start passes none — leaving whatever the environment says
          // (by default nothing, which the server reads as disabled).
          ...(spec.userFile ? { NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT: "true" } : {}),
        },
        stdio: ["ignore", log.fd, log.fd],
      });
      const pid = await spawned(child, command.command);
      return launched<BinaryRuntimeMetadata>({
        schema_version: 1,
        backend: "binary",
        pid,
        command: [command.command, ...args].join(" "),
        log_path: spec.logPath,
        server_package: command.serverPackage,
        server_version: command.serverVersion,
        port: target.port,
        server_url: target.serverUrl,
        data_dir: spec.dataDir,
        created_at: new Date().toISOString(),
        cli_version: spec.cliVersion,
        env: envSummary(env),
      });
    } finally {
      await log.close();
    }
  }

  /**
   * Whether the recorded server is alive, checked for identity: see
   * {@link BinaryLauncher.isRecordRunning}.
   */
  isAlive(record: BinaryRuntimeMetadata): Promise<boolean> {
    return BinaryLauncher.isRecordRunning(record);
  }

  /**
   * Whether a server that was just launched is alive. Not checked for identity:
   * `ps` shows a just-spawned process under its parent's name until it has
   * exec'd, and would wrongly read it as someone else's.
   */
  async isLaunchedAlive(server: Launched<BinaryRuntimeMetadata>): Promise<boolean> {
    return BinaryLauncher.isRunning(server.pid);
  }

  /** The pid and log file, which is where to look when a start fails. */
  describe(record: BinaryRuntimeMetadata): Readonly<Record<string, unknown>> {
    return { runtime: "binary", pid: record.pid, log_path: record.log_path };
  }

  /**
   * Stops the recorded server, leaving alone a pid that no longer belongs to it.
   */
  terminate(record: BinaryRuntimeMetadata): Promise<StopBinaryRuntimeResult> {
    return BinaryLauncher.stopRecord(record);
  }

  /**
   * The end of the server's log file, for explaining a failed start.
   */
  logTail(record: BinaryRuntimeMetadata, lines: number): Promise<string> {
    return BinaryLauncher.readLogs(record.log_path, lines);
  }

  /**
   * What `start` runs: the `ZITADEL_SERVER_BINARY` override, else the platform
   * binary of the bundled `@zitadel/server`, which must be built.
   */
  static command(env: NodeJS.ProcessEnv = process.env): ServerCommand {
    const version = BinaryLauncher.version(env);
    return {
      command: env[COMMAND_ENV] || resolveServerBinary(),
      args: [],
      serverPackage: SERVER_NPM_PACKAGE,
      serverVersion: version,
    };
  }

  /**
   * The server version `start` runs from this CLI: the bundled `@zitadel/server`,
   * or what `ZITADEL_SERVER_BINARY_VERSION` names for an override.
   */
  static version(env: NodeJS.ProcessEnv = process.env): string {
    if (env[COMMAND_ENV]) {
      return env[COMMAND_VERSION_ENV]?.trim() || "override";
    }
    const manifest = require(resolveServerPackageManifest()) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  }

  /**
   * The bundled server version, to compare with a running server's
   * `server_version`: a server another CLI release started serves that
   * release's API. `undefined` when the package cannot be read: a comparison
   * has nothing to go on then, and `start` reports the broken install itself
   * when it tries to run the server.
   */
  static bundledVersion(env: NodeJS.ProcessEnv = process.env): string | undefined {
    try {
      return BinaryLauncher.version(env);
    } catch {
      return undefined;
    }
  }

  /** The bundled server version, or a `ZitadelError` that says how to repair the install. */
  static assertAvailable(): string {
    return BinaryLauncher.available(() => {
      if (!process.env[COMMAND_ENV]) {
        serverBinaryPath();
      }
      return BinaryLauncher.version();
    });
  }

  /** Runs `find`, turning any failure to locate the server into the error that says how to repair the install. */
  private static available<T>(find: () => T): T {
    try {
      return find();
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", "Zitadel server npm package is not available", {
        hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
        nextCommands: [shellCommand("npm install @zitadel/cli@latest")],
        details: { package: SERVER_NPM_PACKAGE, message: errorMessage(error) },
      });
    }
  }

  /**
   * Whether the server a record names is alive. The pid must still belong to it:
   * pids are reused, and after a reboot the recorded one can be any program.
   */
  static async isRecordRunning(record: BinaryRuntimeMetadata): Promise<boolean> {
    return BinaryLauncher.isRunning(record.pid) && (await ownsProcess(record));
  }

  /** Stops the server a record names, and leaves alone a pid that has become something else. */
  static async stopRecord(record: BinaryRuntimeMetadata): Promise<StopBinaryRuntimeResult> {
    if (!(await ownsProcess(record))) {
      return { pid: record.pid, status: "stale", target: "process" };
    }
    return BinaryLauncher.stopPid(record.pid);
  }

  /** Whether the process, or any process left in the group it led, is alive. */
  static isRunning(pid: number): boolean {
    if (BinaryLauncher.isPidRunning(pid)) {
      return true;
    }
    if (process.platform === "win32") {
      return false;
    }
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return isErrno(error, "EPERM");
    }
  }

  /**
   * Whether a process with this pid exists. It says nothing about whose it is:
   * use {@link BinaryLauncher.isRecordRunning} for a recorded server.
   */
  static isPidRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return isErrno(error, "EPERM");
    }
  }

  /**
   * Stops a server by the pid it was recorded under. That pid is also the id of
   * the process group the server was started in, and a group outlives its
   * leader: a server whose leader died is still reached by signalling the group,
   * so liveness is the signal's answer, not a check on the leader alone.
   */
  static async stopPid(pid: number): Promise<StopBinaryRuntimeResult> {
    const term = signalRuntime(pid, "SIGTERM");
    if (!term.sent) {
      return { pid, status: "stale", target: term.target };
    }
    if (await waitForExit(pid, STOP_TIMEOUT_MS)) {
      return { pid, status: "stopped", target: term.target, signal: "SIGTERM" };
    }

    if (BinaryLauncher.isRunning(pid)) {
      const kill = signalRuntime(pid, "SIGKILL");
      if (kill.sent && (await waitForExit(pid, STOP_KILL_TIMEOUT_MS))) {
        return { pid, status: "stopped", target: kill.target, signal: "SIGKILL" };
      }
    }
    return { pid, status: "failed", target: term.target, signal: "SIGKILL" };
  }

  /**
   * A server's whole log file, or an empty string if it has none yet. Read from
   * the file, not the process, so a stopped server's log is still there.
   */
  static async readLog(logPath: string): Promise<string> {
    try {
      return await readFile(logPath, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return "";
      }
      throw error;
    }
  }

  /** The last `tail` lines of a server's log file, or an empty string if it has none yet. */
  static async readLogs(logPath: string, tail: number): Promise<string> {
    const content = await BinaryLauncher.readLog(logPath);
    const lines = content.split(/\r?\n/);
    const hasTrailingNewline = lines.at(-1) === "";
    const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
    const selected = body.slice(-tail).join("\n");
    return selected.length === 0 ? "" : `${selected}${hasTrailingNewline ? "\n" : ""}`;
  }

  /**
   * Hands `sink` the log file as it is, then each part appended to it, until
   * `signal` aborts, by default when the CLI is interrupted. The file is
   * polled by size: it is appended to by another process, and there is no
   * event to wait on that works on every platform.
   */
  static async followLogs(
    logPath: string,
    sink: LogSink,
    options: { clock?: Clock; signal?: AbortSignal } = {},
  ): Promise<void> {
    const clock = options.clock ?? realClock;
    const stop = options.signal ? { signal: options.signal, dispose: () => {} } : stopSignal();
    try {
      const log = new AppendedLog(logPath);
      sink.existing(await log.next());
      while (!stop.signal.aborted) {
        await clock.wait(LOG_POLL_MS, stop.signal);
        if (!stop.signal.aborted) {
          sink.appended(await log.next());
        }
      }
    } finally {
      stop.dispose();
    }
  }
}

/**
 * A log file another process appends to, read a part at a time: each
 * {@link AppendedLog.next} returns what was written since the one before, the
 * first the whole file. Reading by byte offset, rather than by size after a
 * read, loses nothing written in between. A part ends where the file did when
 * it was read, which can be inside a character, so the decoder keeps a
 * character's first bytes until the rest are read.
 */
export class AppendedLog {
  private readonly path: string;
  private readonly decoder = new StringDecoder("utf8");
  private offset = 0;

  constructor(path: string) {
    this.path = path;
  }

  async next(): Promise<string> {
    const size = await fileSize(this.path);
    // A file shorter than what was read of it is another one, as after it was
    // deleted: it is read from the top.
    if (size < this.offset) {
      this.offset = 0;
    }
    if (size === this.offset) {
      return "";
    }
    const bytes = await readBytes(this.path, this.offset, size - this.offset);
    this.offset += bytes.length;
    return this.decoder.write(bytes);
  }
}

/**
 * Whether the recorded pid still belongs to the server that was started. The
 * process, or one left in the group it led, must run the program that was
 * started or the server itself (which is what a launcher that died leaves
 * behind), and must be serving this record's data directory: every directory's
 * server runs the same program, so the data directory in its environment is
 * what tells them apart. Where the process list or a process's environment
 * cannot be read (no `ps`, Windows) the pid is trusted, as it was before.
 */
async function ownsProcess(record: BinaryRuntimeMetadata): Promise<boolean> {
  if (process.platform === "win32") {
    return true;
  }
  const started = basename(record.command.split(" ")[0] ?? "");
  if (started === "") {
    return true;
  }
  const programs = [started, SERVER_PROGRAM];
  let listing: string;
  try {
    // `ww`: without it `ps` cuts the command column to `COLUMNS` (which tools
    // such as pnpm and moon export), and the server's long path is cut before its name.
    listing = await ps(["axww", "-o", "pid=,pgid=,command="]);
  } catch {
    return true;
  }
  const candidates = listing.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    const named = match !== null && programs.some((program) => (match[3] ?? "").includes(program));
    const ours =
      match !== null && (Number(match[1]) === record.pid || Number(match[2]) === record.pid);
    return named && ours ? [Number(match[1])] : [];
  });
  for (const pid of candidates) {
    if (await servesDataDir(pid, record.data_dir)) {
      return true;
    }
  }
  return false;
}

const DATA_DIR_VARIABLE = "NEXTGEN_SERVER_DATA_DIR=";

/** Whether a process serves a data directory, or its environment does not say. */
async function servesDataDir(pid: number, dataDir: string): Promise<boolean> {
  let command: string;
  try {
    command = await ps(["eww", "-p", String(pid), "-o", "command="]);
  } catch {
    return true;
  }
  const at = command.indexOf(DATA_DIR_VARIABLE);
  if (at === -1) {
    return true;
  }
  const rest = command.slice(at + DATA_DIR_VARIABLE.length);
  return (
    rest.startsWith(dataDir) &&
    (rest.length === dataDir.length || /\s/.test(rest[dataDir.length] ?? ""))
  );
}

/**
 * Runs `ps` and returns its output, rejecting where `ps` is missing or fails.
 */
function ps(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "ps",
      args,
      { timeout: 3000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/**
 * Waits for a spawned server to exist, and detaches it. A binary that cannot be
 * run (missing, not executable) is reported by an `error` event, not thrown: left
 * unhandled it crashes the CLI with a stack trace, so it is awaited here and
 * turned into an error that says what to do.
 */
async function spawned(child: ReturnType<typeof spawn>, command: string): Promise<number> {
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () =>
        child.pid ? resolve(child.pid) : reject(new Error("server process did not expose a pid")),
      );
    });
    // Anything it reports from here on, such as a failed signal, is not the start's to raise.
    child.on("error", () => undefined);
    child.unref();
    return pid;
  } catch (error) {
    throw new ZitadelError("E_VALIDATION", "The Zitadel server could not be started", {
      hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
      nextCommands: [shellCommand("npm install @zitadel/cli@latest")],
      details: { command, message: errorMessage(error) },
    });
  }
}

function resolveServerPackageManifest(): string {
  try {
    return require.resolve(`${SERVER_NPM_PACKAGE}/package.json`);
  } catch (error) {
    throw new Error(`Missing ${SERVER_NPM_PACKAGE}. Reinstall @zitadel/cli.`, { cause: error });
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return 0;
    }
    throw error;
  }
}

/** Up to `length` bytes of a file from `position` on; none for a file that is gone. */
async function readBytes(path: string, position: number, length: number): Promise<Buffer> {
  let file: FileHandle;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return Buffer.alloc(0);
    }
    throw error;
  }
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Signals one process. `false` when there is no such process, which is an answer, not an error.
 */
function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (isErrno(error, "ESRCH")) {
      return false;
    }
    throw error;
  }
}

/**
 * Signals the whole process group the server was started in, falling back to the
 * process itself where there is no such group (Windows). The group, not the pid,
 * is what finds a server whose launcher died: a group lives as long as any
 * member does.
 */
function signalRuntime(
  pid: number,
  signal: NodeJS.Signals,
): { sent: boolean; target: "process" | "process-group" } {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return { sent: true, target: "process-group" };
    } catch (error) {
      if (!isErrno(error, "ESRCH")) {
        throw error;
      }
    }
  }
  return { sent: signalProcess(pid, signal), target: "process" };
}

/**
 * Waits for a stopped server to be gone. It polls: the server is not this
 * process's child, so there is no exit event to wait on.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!BinaryLauncher.isRunning(pid)) {
      return true;
    }
    await delay(200);
  }
  return !BinaryLauncher.isRunning(pid);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * The server applies schema migrations only when asked, and a local server must.
 */
function withMigrateFlag(args: string[]): string[] {
  return args.includes(MIGRATE_FLAG) ? args : [...args, MIGRATE_FLAG];
}
