import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { ZitadelError } from "../errors";
import {
  type BinaryRuntimeMetadata,
  type RuntimeMetadata,
  checkLocalServerHealth,
} from "./runtime";

export const SERVER_NPM_PACKAGE = "@zitadel/server";
const START_COMMAND_ENV = "ZITADEL_SERVER_BINARY";
const STOP_TIMEOUT_MS = 10_000;
const STOP_KILL_TIMEOUT_MS = 2_000;

const require = createRequire(import.meta.url);

export type BinaryRunSpec = {
  cliVersion: string;
  dataDir: string;
  logPath: string;
  port: number;
  serverUrl: string;
};

export type StopBinaryRuntimeResult = Readonly<{
  pid: number;
  signal?: NodeJS.Signals;
  status: "failed" | "stale" | "stopped";
  target: "process" | "process-group";
}>;

export type ReapEmbeddedPostgresResult = Readonly<{
  // `absent`: no lock file, nothing to reap. `stale`: lock file pointed at a
  // dead process; we cleared it. `stopped`: we terminated a live postmaster.
  // `failed`: a live postmaster ignored SIGINT and SIGKILL.
  status: "absent" | "failed" | "stale" | "stopped";
  pid?: number;
  signal?: NodeJS.Signals;
}>;

// The local server binary launches embedded Postgres through `pg_ctl start`,
// which double-forks and setsid()s the postmaster into its own session. That
// deliberately escapes the server's process group, so the group SIGTERM that
// stopBinaryRuntime sends never reaches Postgres. The server itself stops it on
// a graceful shutdown (`pg_ctl stop`), but any path that skips that shutdown — a
// SIGKILL escalation, a crash, or a SIGTERM during the startup window before the
// server installs its signal handler — leaves the postmaster orphaned (reparented
// to PID 1) still holding this lock, which blocks the next `pg_ctl start` with
// "another server might be running". Mirrors embeddedPostgresOptions in
// cmd/server/server.go.
const EMBEDDED_POSTGRES_PID_FILE = join("embedded-postgres", "data", "postmaster.pid");

export function resolveServerCommand(env: NodeJS.ProcessEnv = process.env): {
  command: string;
  args: string[];
  serverPackage: string;
  serverVersion: string;
} {
  if (env[START_COMMAND_ENV]) {
    return {
      command: env[START_COMMAND_ENV],
      args: [],
      serverPackage: SERVER_NPM_PACKAGE,
      serverVersion: "override",
    };
  }

  const manifestPath = resolveServerPackageManifest();
  const manifest = require(manifestPath) as { version?: unknown };
  return {
    command: process.execPath,
    args: [join(dirname(manifestPath), "bin", "zitadel-server.js")],
    serverPackage: SERVER_NPM_PACKAGE,
    serverVersion: typeof manifest.version === "string" ? manifest.version : "unknown",
  };
}

export async function startBinaryRuntime(spec: BinaryRunSpec): Promise<BinaryRuntimeMetadata> {
  const command = resolveServerCommand();
  await mkdir(dirname(spec.logPath), { recursive: true, mode: 0o700 });
  const log = await open(spec.logPath, "a", 0o600);
  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      env: {
        ...process.env,
        NEXTGEN_SERVER_ADDRESS: `:${String(spec.port)}`,
        NEXTGEN_SERVER_DATA_DIR: spec.dataDir,
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
      command: [command.command, ...command.args].join(" "),
      log_path: spec.logPath,
      server_package: command.serverPackage,
      server_version: command.serverVersion,
      port: spec.port,
      server_url: spec.serverUrl,
      data_dir: spec.dataDir,
      created_at: new Date().toISOString(),
      cli_version: spec.cliVersion,
    };
  } finally {
    await log.close();
  }
}

export async function stopBinaryRuntime(pid: number): Promise<StopBinaryRuntimeResult> {
  if (!isProcessRunning(pid)) {
    return { pid, status: "stale", target: "process" };
  }
  const term = signalRuntime(pid, "SIGTERM");
  if (!term.sent) {
    return { pid, status: "stale", target: term.target };
  }
  if (await waitForExit(pid, STOP_TIMEOUT_MS)) {
    return { pid, status: "stopped", target: term.target, signal: "SIGTERM" };
  }

  if (isProcessRunning(pid)) {
    const kill = signalRuntime(pid, "SIGKILL");
    if (kill.sent && (await waitForExit(pid, STOP_KILL_TIMEOUT_MS))) {
      return { pid, status: "stopped", target: kill.target, signal: "SIGKILL" };
    }
  }
  return { pid, status: "failed", target: term.target, signal: "SIGKILL" };
}

export type ReapEmbeddedPostgresOptions = {
  // How long to wait for the postmaster to honour the SIGINT fast-shutdown
  // before escalating, and then for the SIGKILL to take effect. Defaults match
  // stopBinaryRuntime; exposed mainly so tests can keep the escalation fast.
  fastShutdownTimeoutMs?: number;
  killTimeoutMs?: number;
};

/**
 * Best-effort reap of an embedded Postgres left behind for `dataDir`. Reads the
 * postmaster's own lock file, and if that process is still alive, stops it
 * directly — the CLI-side safety net for the orphan cases the server's graceful
 * shutdown cannot cover (see {@link EMBEDDED_POSTGRES_PID_FILE}). SIGINT triggers
 * Postgres' "fast shutdown"; its backends exit on their own once the postmaster
 * is gone, so signalling the postmaster PID is enough. Escalates to SIGKILL.
 * A no-op (`absent`) when the data directory has no live embedded Postgres, so it
 * is safe to call on every stop and before every start.
 */
export async function reapEmbeddedPostgres(
  dataDir: string,
  options: ReapEmbeddedPostgresOptions = {},
): Promise<ReapEmbeddedPostgresResult> {
  const fastShutdownTimeoutMs = options.fastShutdownTimeoutMs ?? STOP_TIMEOUT_MS;
  const killTimeoutMs = options.killTimeoutMs ?? STOP_KILL_TIMEOUT_MS;
  const pidFile = join(dataDir, EMBEDDED_POSTGRES_PID_FILE);
  const pid = await readPostmasterPid(pidFile);
  if (pid === undefined) {
    return { status: "absent" };
  }
  if (!isProcessRunning(pid)) {
    // A dead owner is a stale lock. `pg_ctl start` would clear it itself, but
    // leaving a pristine directory keeps the next start's failure modes simple.
    await rm(pidFile, { force: true });
    return { status: "stale", pid };
  }

  signalProcess(pid, "SIGINT");
  if (await waitForExit(pid, fastShutdownTimeoutMs)) {
    await rm(pidFile, { force: true });
    return { status: "stopped", pid, signal: "SIGINT" };
  }

  signalProcess(pid, "SIGKILL");
  if (await waitForExit(pid, killTimeoutMs)) {
    await rm(pidFile, { force: true });
    return { status: "stopped", pid, signal: "SIGKILL" };
  }
  return { status: "failed", pid };
}

async function readPostmasterPid(pidFile: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(pidFile, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  // postmaster.pid records the postmaster PID on its first line.
  const [firstLine] = raw.split(/\r?\n/, 1);
  const pid = Number.parseInt(firstLine ?? "", 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrno(error, "EPERM");
  }
}

export async function binaryLogs(logPath: string, tail: number): Promise<string> {
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

export async function followBinaryLogs(logPath: string, tail: number): Promise<void> {
  process.stdout.write(await binaryLogs(logPath, tail));
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

export async function assertServerPackageAvailable(): Promise<string> {
  try {
    const command = resolveServerCommand();
    return command.serverVersion;
  } catch (error) {
    throw new ZitadelError("E_VALIDATION", "Zitadel server npm package is not available", {
      hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
      nextCommands: ["npm install @zitadel/cli@alpha"],
      details: { package: SERVER_NPM_PACKAGE, message: errorMessage(error) },
    });
  }
}

export async function binaryRuntimeHealthy(runtime: RuntimeMetadata): Promise<boolean> {
  return (
    runtime.backend === "binary" &&
    isProcessRunning(runtime.pid) &&
    (await checkLocalServerHealth(runtime.server_url))
  );
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
    if (!isProcessRunning(pid)) {
      return true;
    }
    await delay(200);
  }
  return !isProcessRunning(pid);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
