import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
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
const START_COMMAND_VERSION_ENV = "ZITADEL_SERVER_BINARY_VERSION";
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
      serverVersion: env[START_COMMAND_VERSION_ENV]?.trim() || "override",
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
        // Browser-facing URLs (claim, dashboard) must point at this local
        // server, not the cloud default the server config falls back to.
        NEXTGEN_SERVER_PUBLIC_BASE: spec.serverUrl,
        // The platform project hosts the console's own sign-in and the
        // personal teams a claim attaches to. Without it the console falls
        // back to the app's own project: the claim page's sign-in is then
        // rejected on origin and `claim/complete` refuses every session, while
        // the CLI waits out the link. A CLI-owned data dir is the one place
        // enabling it is safe — nothing else provisions projects there.
        NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT: "true",
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
