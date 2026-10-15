import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { resolveServerBinary, serverBinaryPath } from "@zitadel/server/binary";

import { ZitadelError } from "../../errors";
import { EMPTY_ENV, type ResolvedEnv, envSummary } from "../env-vars";
import type { BinaryRuntimeMetadata } from "../runtime";
import type { Launcher } from "./lifecycle";

export const SERVER_NPM_PACKAGE = "@zitadel/server";
const COMMAND_ENV = "ZITADEL_SERVER_BINARY";
const COMMAND_VERSION_ENV = "ZITADEL_SERVER_BINARY_VERSION";
const STOP_TIMEOUT_MS = 10_000;
const STOP_KILL_TIMEOUT_MS = 2_000;
const MIGRATE_FLAG = "--migrate";

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
 */
export class BinaryLauncher implements Launcher<BinaryRuntimeMetadata> {
  private readonly spec: BinaryLaunchSpec;

  constructor(spec: BinaryLaunchSpec) {
    this.spec = spec;
  }

  async launch(target: { port: number; serverUrl: string }): Promise<BinaryRuntimeMetadata> {
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
      child.unref();
      if (!child.pid) {
        throw new Error("server process did not expose a pid");
      }
      return {
        schema_version: 1,
        backend: "binary",
        pid: child.pid,
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
      };
    } finally {
      await log.close();
    }
  }

  async isAlive(record: BinaryRuntimeMetadata): Promise<boolean> {
    return BinaryLauncher.isRunning(record.pid);
  }

  terminate(record: BinaryRuntimeMetadata): Promise<StopBinaryRuntimeResult> {
    return BinaryLauncher.stopPid(record.pid);
  }

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
        nextCommands: ["npm install @zitadel/cli@alpha"],
        details: { package: SERVER_NPM_PACKAGE, message: errorMessage(error) },
      });
    }
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

  static async readLogs(logPath: string, tail: number): Promise<string> {
    let content = "";
    try {
      content = await readFile(logPath, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return "";
      }
      throw error;
    }
    const lines = content.split(/\r?\n/);
    const hasTrailingNewline = lines.at(-1) === "";
    const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
    const selected = body.slice(-tail).join("\n");
    return selected.length === 0 ? "" : `${selected}${hasTrailingNewline ? "\n" : ""}`;
  }

  static async followLogs(logPath: string, tail: number): Promise<void> {
    process.stdout.write(await BinaryLauncher.readLogs(logPath, tail));
    let offset = await fileSize(logPath);
    await new Promise<void>((resolveFollow, reject) => {
      const interval = setInterval(() => {
        void (async () => {
          try {
            const size = await fileSize(logPath);
            if (size > offset) {
              const stream = createReadStream(logPath, { start: offset, end: size - 1 });
              stream.pipe(process.stdout, { end: false });
              offset = size;
            }
          } catch (error) {
            reject(error);
          }
        })();
      }, 1000);
      const stop = () => {
        clearInterval(interval);
        resolveFollow();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
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

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function withMigrateFlag(args: string[]): string[] {
  return args.includes(MIGRATE_FLAG) ? args : [...args, MIGRATE_FLAG];
}
