import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import { ZitadelError } from "../errors";
import { isObject, parseJsonObject } from "../json";
import { defaultPreviewImageForVersion } from "../versions";

export const DEFAULT_LOCAL_SERVER_PORT = 8080;
export const DEFAULT_LOCAL_SERVER_URL = "http://localhost:8080";
export const LOCAL_RUNTIME_DIR = ".zitadel/local";
export const LOCAL_DATA_DIR = ".zitadel/local/nextgen-data";
export const LOCAL_RUNTIME_FILE = ".zitadel/local/runtime.json";
export const LOCAL_CONTAINER_PASSWD_FILE = ".zitadel/local/container-passwd";
export const LOCAL_CONTAINER_GROUP_FILE = ".zitadel/local/container-group";
export const CONTAINER_DATA_DIR = "/var/lib/zitadel/nextgen-data";
export const CONTAINER_HTTP_PORT = 8080;

export type RuntimeMetadata = {
  schema_version: 1;
  container_name: string;
  container_id: string;
  image: string;
  port: number;
  server_url: string;
  data_dir: string;
  created_at: string;
  cli_version: string;
};

export type LocalRuntimePaths = {
  runtimeDir: string;
  dataDir: string;
  runtimeFile: string;
  containerPasswdFile: string;
  containerGroupFile: string;
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

export function defaultLocalServerImage(cliVersion: string): string {
  return defaultPreviewImageForVersion(cliVersion);
}

export async function ensureLocalState(cwd: string): Promise<LocalRuntimePaths> {
  const paths = localRuntimePaths(cwd);
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  await appendGitignoreEntry(cwd, `${LOCAL_RUNTIME_DIR}/`);
  return paths;
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

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });
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
    typeof input.container_name !== "string" ||
    typeof input.container_id !== "string" ||
    typeof input.image !== "string" ||
    typeof input.port !== "number" ||
    !isValidPort(input.port) ||
    typeof input.server_url !== "string" ||
    !isValidServerUrl(input.server_url, input.port) ||
    typeof input.data_dir !== "string" ||
    typeof input.created_at !== "string" ||
    typeof input.cli_version !== "string"
  ) {
    throw new ZitadelError("E_VALIDATION", `${LOCAL_RUNTIME_FILE} is malformed`, {
      hint: "Run `zitadel reset --force`, then `zitadel start`.",
      nextCommands: ["zitadel reset --force", "zitadel start"],
      details: input,
    });
  }
  return {
    schema_version: 1,
    container_name: input.container_name,
    container_id: input.container_id,
    image: input.image,
    port: input.port,
    server_url: input.server_url,
    data_dir: input.data_dir,
    created_at: input.created_at,
    cli_version: input.cli_version,
  };
}

export async function assertWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await access(path, constants.W_OK);
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
  return {
    configured: true,
    container_name: metadata.container_name,
    container_id: metadata.container_id,
    image: metadata.image,
    port: metadata.port,
    server_url: metadata.server_url,
    data_dir: metadata.data_dir,
    created_at: metadata.created_at,
  };
}

export function isRuntimeObject(value: unknown): value is RuntimeMetadata {
  return isObject(value) && value.schema_version === 1;
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
