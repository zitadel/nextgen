import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { ZitadelError } from "../errors";
import { isObject, parseJsonObject } from "../json";

export const LOCAL_SERVER_IMAGE_NAME = "ghcr.io/zitadel/nextgen";
export const DEFAULT_LOCAL_SERVER_IMAGE = `${LOCAL_SERVER_IMAGE_NAME}:latest`;
export const DEFAULT_LOCAL_SERVER_PORT = 8080;
export const DEFAULT_LOCAL_SERVER_URL = "http://localhost:8080";
export const LOCAL_RUNTIME_DIR = ".zitadel/local";
export const LOCAL_DATA_DIR = ".zitadel/local/nextgen-data";
export const LOCAL_RUNTIME_FILE = ".zitadel/local/runtime.json";
export const LOCAL_SERVER_LOG_FILE = ".zitadel/local/server.log";
export const LOCAL_CONTAINER_PASSWD_FILE = ".zitadel/local/container-passwd";
export const LOCAL_CONTAINER_GROUP_FILE = ".zitadel/local/container-group";
export const CONTAINER_DATA_DIR = "/var/lib/zitadel/nextgen-data";
export const CONTAINER_HTTP_PORT = 8080;

export type RuntimeBackend = "binary" | "docker";

/**
 * The launch contract: the environment the CLI hands the server when it
 * starts a runtime, versioned so `start` can tell a runtime that is merely
 * healthy from one that is healthy *and* launched the way the current CLI
 * launches it. A running process cannot pick up a new variable, so a change
 * to that environment is invisible to the health probe alone — the runtime
 * keeps answering `/healthz` while the feature that needed the variable stays
 * broken. Bump this whenever the launch environment changes in a way an
 * already-running runtime must be restarted to receive; `start` then restarts
 * runtimes recorded under an older (or no) contract, keeping their data dir.
 *
 * 1 — `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true`: the platform project the
 *     console's sign-in and `zitadel claim` need.
 */
export const LAUNCH_CONTRACT = 1;

type RuntimeMetadataBase = {
  schema_version: 1;
  backend: RuntimeBackend;
  port: number;
  server_url: string;
  data_dir: string;
  created_at: string;
  cli_version: string;
  /**
   * The {@link LAUNCH_CONTRACT} the runtime was started under. Absent on
   * records written by CLIs that predate the marker, which is exactly what
   * makes those runtimes restart on the next `start`.
   */
  launch_contract?: number;
};

export type BinaryRuntimeMetadata = RuntimeMetadataBase & {
  backend: "binary";
  pid: number;
  command: string;
  log_path: string;
  server_package: string;
  server_version: string;
};

export type DockerRuntimeMetadata = RuntimeMetadataBase & {
  backend: "docker";
  container_name: string;
  container_id: string;
  image: string;
};

export type RuntimeMetadata = BinaryRuntimeMetadata | DockerRuntimeMetadata;

export type LocalRuntimePaths = {
  runtimeDir: string;
  dataDir: string;
  runtimeFile: string;
  logFile: string;
  containerPasswdFile: string;
  containerGroupFile: string;
};

export type WritablePathProbe = {
  targetPath: string;
  checkedPath: string;
};

export type ContainerIdentity = {
  uid: number;
  gid: number;
  passwdFile: string;
  groupFile: string;
};

export function localRuntimePaths(cwd: string): LocalRuntimePaths {
  return {
    runtimeDir: join(cwd, LOCAL_RUNTIME_DIR),
    dataDir: join(cwd, LOCAL_DATA_DIR),
    runtimeFile: join(cwd, LOCAL_RUNTIME_FILE),
    logFile: join(cwd, LOCAL_SERVER_LOG_FILE),
    containerPasswdFile: join(cwd, LOCAL_CONTAINER_PASSWD_FILE),
    containerGroupFile: join(cwd, LOCAL_CONTAINER_GROUP_FILE),
  };
}

export function localContainerName(cwd: string): string {
  const hash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12);
  return `zitadel-server-${hash}`;
}

export function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function defaultLocalServerImageForCliVersion(cliVersion: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  if (/^\d+\.\d+\.\d+-alpha\.\d+$/.test(normalized)) {
    return `${LOCAL_SERVER_IMAGE_NAME}:${normalized}`;
  }
  return DEFAULT_LOCAL_SERVER_IMAGE;
}

export async function ensureLocalState(cwd: string): Promise<LocalRuntimePaths> {
  const paths = localRuntimePaths(cwd);
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  await appendGitignoreEntry(cwd, `${LOCAL_RUNTIME_DIR}/`);
  return paths;
}

export async function assertLocalStateWritable(cwd: string): Promise<WritablePathProbe> {
  const paths = localRuntimePaths(cwd);
  const checkedPath = await nearestExistingDirectory(paths.dataDir);
  await access(checkedPath, constants.W_OK);
  return { targetPath: paths.dataDir, checkedPath };
}

export async function ensureContainerIdentity(
  cwd: string,
  user: { uid?: number; gid?: number },
): Promise<ContainerIdentity | undefined> {
  if (user.uid === undefined || user.uid <= 0) {
    return undefined;
  }
  const gid = user.gid ?? user.uid;
  const paths = localRuntimePaths(cwd);
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await writeFile(
    paths.containerPasswdFile,
    [
      "root:x:0:0:root:/root:/bin/sh",
      "nonroot:x:65532:65532:nonroot:/nonexistent:/usr/sbin/nologin",
      `zitadel-local:x:${String(user.uid)}:${String(gid)}:Zitadel local user:/tmp:/usr/sbin/nologin`,
      "",
    ].join("\n"),
    { mode: 0o644 },
  );
  await writeFile(
    paths.containerGroupFile,
    [
      "root:x:0:",
      "nonroot:x:65532:",
      `zitadel-local:x:${String(gid)}:`,
      "",
    ].join("\n"),
    { mode: 0o644 },
  );
  return {
    uid: user.uid,
    gid,
    passwdFile: paths.containerPasswdFile,
    groupFile: paths.containerGroupFile,
  };
}

export async function readRuntimeMetadata(cwd: string): Promise<RuntimeMetadata | undefined> {
  const paths = localRuntimePaths(cwd);
  let raw: string;
  try {
    raw = await readFile(paths.runtimeFile, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }

  const parsed = parseJsonObject(raw, LOCAL_RUNTIME_FILE);
  return normalizeRuntimeMetadata(parsed);
}

export async function writeRuntimeMetadata(cwd: string, metadata: RuntimeMetadata): Promise<void> {
  const paths = localRuntimePaths(cwd);
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.runtimeFile, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
}

export async function removeRuntimeMetadata(cwd: string): Promise<void> {
  await rm(localRuntimePaths(cwd).runtimeFile, { force: true });
}

export async function removeLocalData(cwd: string): Promise<void> {
  await rm(localRuntimePaths(cwd).dataDir, { recursive: true, force: true });
}

export async function checkLocalServerHealth(serverUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const healthUrl = new URL("/healthz", serverUrl);
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort local-server detection for optional UI (the setup wizard's
 * server choice). Same sources as {@link resolveLocalServer} — the runtime
 * metadata written by `zitadel start`, then the default localhost URL — but
 * never throws: a malformed `runtime.json` or an unhealthy server yields
 * `undefined` (doctor owns diagnosing those states), and an unhealthy
 * metadata URL still falls back to the default-port probe so a server
 * started from a different directory is found.
 */
export async function detectHealthyLocalServer(cwd: string): Promise<string | undefined> {
  let runtime: RuntimeMetadata | undefined;
  try {
    runtime = await readRuntimeMetadata(cwd);
  } catch {
    runtime = undefined;
  }
  if (runtime && (await checkLocalServerHealth(runtime.server_url))) {
    return runtime.server_url;
  }
  const alreadyProbedDefault = runtime?.server_url === DEFAULT_LOCAL_SERVER_URL;
  if (!alreadyProbedDefault && (await checkLocalServerHealth(DEFAULT_LOCAL_SERVER_URL))) {
    return DEFAULT_LOCAL_SERVER_URL;
  }
  return undefined;
}

export async function resolveLocalServer(cwd: string): Promise<string> {
  const runtime = await readRuntimeMetadata(cwd);
  if (runtime) {
    if (await checkLocalServerHealth(runtime.server_url)) {
      return runtime.server_url;
    }
    throw localServerNotRunning(runtime.server_url);
  }

  if (await checkLocalServerHealth(DEFAULT_LOCAL_SERVER_URL)) {
    return DEFAULT_LOCAL_SERVER_URL;
  }
  throw localServerNotRunning(DEFAULT_LOCAL_SERVER_URL);
}

export function localServerNotRunning(serverUrl: string): ZitadelError {
  return new ZitadelError("E_LOCAL_SERVER_NOT_RUNNING", "Local Zitadel server is not running", {
    hint: `No healthy local server responded at ${serverUrl}.`,
    nextCommands: ["zitadel start"],
    details: { server_url: serverUrl },
  });
}

async function appendGitignoreEntry(cwd: string, entry: string): Promise<void> {
  const path = join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }

  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry)) {
    return;
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${prefix}${entry}\n`);
}

function normalizeRuntimeMetadata(input: Record<string, unknown>): RuntimeMetadata {
  if (
    input.schema_version !== 1 ||
    typeof input.port !== "number" ||
    !isValidPort(input.port) ||
    typeof input.server_url !== "string" ||
    !isValidServerUrl(input.server_url, input.port) ||
    typeof input.data_dir !== "string" ||
    typeof input.created_at !== "string" ||
    typeof input.cli_version !== "string"
  ) {
    throw malformedRuntime(input);
  }

  const backend = input.backend === undefined ? "docker" : input.backend;
  const base = {
    schema_version: 1 as const,
    port: input.port,
    server_url: input.server_url,
    data_dir: input.data_dir,
    created_at: input.created_at,
    cli_version: input.cli_version,
    // Optional so records from older CLIs still parse; anything that is not
    // a positive integer reads as "no contract", i.e. restart on `start`.
    ...(typeof input.launch_contract === "number" &&
    Number.isInteger(input.launch_contract) &&
    input.launch_contract > 0
      ? { launch_contract: input.launch_contract }
      : {}),
  };

  if (backend === "binary") {
    if (
      typeof input.pid !== "number" ||
      !Number.isInteger(input.pid) ||
      input.pid <= 0 ||
      typeof input.command !== "string" ||
      typeof input.log_path !== "string" ||
      typeof input.server_package !== "string" ||
      typeof input.server_version !== "string"
    ) {
      throw malformedRuntime(input);
    }
    return {
      ...base,
      backend: "binary",
      pid: input.pid,
      command: input.command,
      log_path: input.log_path,
      server_package: input.server_package,
      server_version: input.server_version,
    };
  }

  if (
    backend !== "docker" ||
    typeof input.container_name !== "string" ||
    typeof input.container_id !== "string" ||
    typeof input.image !== "string"
  ) {
    throw malformedRuntime(input);
  }
  return {
    ...base,
    backend: "docker",
    container_name: input.container_name,
    container_id: input.container_id,
    image: input.image,
  };
}

export async function assertWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await access(path, constants.W_OK);
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      const info = await stat(current);
      if (!info.isDirectory()) {
        throw new Error(`${current} exists but is not a directory`);
      }
      return current;
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
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

export function runtimeSummary(metadata: RuntimeMetadata | undefined): Record<string, unknown> {
  if (!metadata) {
    return { configured: false };
  }
  const base = {
    configured: true,
    backend: metadata.backend,
    port: metadata.port,
    server_url: metadata.server_url,
    data_dir: metadata.data_dir,
    created_at: metadata.created_at,
  };
  if (metadata.backend === "binary") {
    return {
      ...base,
      pid: metadata.pid,
      command: metadata.command,
      log_path: metadata.log_path,
      server_package: metadata.server_package,
      server_version: metadata.server_version,
    };
  }
  return {
    ...base,
    container_name: metadata.container_name,
    container_id: metadata.container_id,
    image: metadata.image,
  };
}

export function isRuntimeObject(value: unknown): value is RuntimeMetadata {
  return isObject(value) && value.schema_version === 1;
}

/**
 * Whether a recorded runtime was launched under the current
 * {@link LAUNCH_CONTRACT}, and so may be reused by `start` rather than
 * restarted. A record without the marker was written by a CLI that predates
 * it; a higher value comes from a newer CLI and is treated the same way, since
 * this CLI cannot know what that launch environment contained.
 */
export function hasCurrentLaunchContract(metadata: RuntimeMetadata | undefined): boolean {
  return metadata?.launch_contract === LAUNCH_CONTRACT;
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function isValidServerUrl(value: string, port: number): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      explicitUrlPort(value) === port
    );
  } catch {
    return false;
  }
}

function explicitUrlPort(value: string): number | undefined {
  const match = value.match(/^[a-z][a-z\d+\-.]*:\/\/(?:\[[^\]]+\]|[^/?#:]+):(\d+)(?:[/?#]|$)/i);
  if (!match) {
    return undefined;
  }
  const port = Number(match[1]);
  return isValidPort(port) ? port : undefined;
}

function malformedRuntime(input: Record<string, unknown>): ZitadelError {
  return new ZitadelError("E_VALIDATION", `${LOCAL_RUNTIME_FILE} is malformed`, {
    hint: "Run `zitadel reset --force`, then `zitadel start`.",
    nextCommands: ["zitadel reset --force", "zitadel start"],
    details: input,
  });
}
