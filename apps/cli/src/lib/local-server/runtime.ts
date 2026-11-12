import { createHash } from "node:crypto";
import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { isErrno, ZitadelError, errorMessage } from "@/lib/errors";
import { isTrainVersion } from "@/lib/public-cli";

import { readIfExists } from "@/lib/fs";
import { parseJsonObject } from "@/lib/json";
import { ancestors } from "@/lib/paths";
import { EMPTY_SUMMARY, type EnvSummary, isEnvSummary, LOCAL_DEFAULTS } from "./env-vars";
import { isLoopbackHost } from "@/lib/host";
import { userAgent } from "@/lib/user-agent";

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

/**
 * The well-known id of a deployment's platform project (`domain.PlatformProjectID`,
 * `internal/domain/project.go`). A CLI-managed local server bootstraps it, which
 * is what gives the developer a team to own their projects with.
 */
export const PLATFORM_PROJECT_ID = "proj_platform";

/**
 * The platform project's browser-safe key, read from the console runtime
 * document, or `undefined` when the server does not host the platform project.
 * The document sits outside the API, so the generated client does not cover
 * it; it publishes the deployment's default project, which the platform
 * bootstrap pins to {@link PLATFORM_PROJECT_ID}. Fail closed: an unreadable,
 * absent or hanging document reads as not hosted.
 */
export async function readPlatformRuntime(
  serverUrl: string,
  timeoutMs = 1500,
): Promise<{ publishable_key: string } | undefined> {
  try {
    const res = await fetch(new URL("/console/runtime.json", serverUrl), {
      headers: { "user-agent": userAgent() },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Read to the end rather than left unread: an unread body keeps the abort timer
      // tied to a live stream, and its abort then lands where nothing handles it.
      await res.arrayBuffer();
      return undefined;
    }
    const doc = (await res.json()) as { console_project_id?: unknown; publishable_key?: unknown };
    return doc.console_project_id === PLATFORM_PROJECT_ID && typeof doc.publishable_key === "string"
      ? { publishable_key: doc.publishable_key }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The local runtimes `--runtime` names, and what a runtime record may hold. */
export const RUNTIME_BACKENDS = ["binary", "docker"] as const;

export type RuntimeBackend = (typeof RUNTIME_BACKENDS)[number];

/**
 * Decides which backend (`binary` or `docker`) a command works with. The first
 * rule that applies wins:
 *
 * 1. The backend asked for with `--runtime`.
 * 2. The backend the project's existing server already uses, so a later command
 *    keeps talking to the server that is running instead of switching.
 * 3. Docker, when an image was named, either with `--image` or through the
 *    environment, since an image only means something to Docker.
 * 4. Otherwise the npm-distributed server binary.
 *
 * `start` has no existing server to defer to, so it leaves `existingRuntime` out
 * and skips the second rule. `doctor` passes it.
 *
 * @param input.runtime The raw `--runtime` flag value. Anything other than
 * `"binary"` or `"docker"` (including `undefined`) means "not given".
 * @param input.image The `--image` flag value.
 * @param input.envImage The image named by the environment, if any.
 * @param input.existingRuntime The recorded runtime of the project's server.
 * @returns The backend to use.
 */
export function resolveRuntimeBackend(input: {
  runtime: unknown;
  image: string | undefined;
  envImage: string | undefined;
  existingRuntime?: { backend: RuntimeBackend } | undefined;
}): RuntimeBackend {
  if (input.runtime === "binary" || input.runtime === "docker") {
    return input.runtime;
  }
  if (input.existingRuntime) {
    return input.existingRuntime.backend;
  }
  if (input.image || input.envImage) {
    return "docker";
  }
  return "binary";
}

type RuntimeMetadataBase = {
  schema_version: 1;
  backend: RuntimeBackend;
  port: number;
  server_url: string;
  data_dir: string;
  created_at: string;
  cli_version: string;
  /** Absent on runtime files written before the env summary existed. */
  env?: EnvSummary;
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
  if (isTrainVersion(normalized)) {
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
    ["root:x:0:", "nonroot:x:65532:", `zitadel-local:x:${String(gid)}:`, ""].join("\n"),
    { mode: 0o644 },
  );
  return {
    uid: user.uid,
    gid,
    passwdFile: paths.containerPasswdFile,
    groupFile: paths.containerGroupFile,
  };
}

/**
 * The nearest directory, from `cwd` upward, that holds `file`, or `undefined`
 * when none does. `zitadel start` keeps its state in the directory it ran in,
 * and an app created inside that directory reads it from there. Only readers
 * walk up: commands that write or remove local state act on `cwd` alone.
 *
 * The walk ends at `stopAt`, the home directory by default, and skips a file
 * another user owns: local state names a server to talk to and a credential to
 * sign in with, so it is only taken from somewhere the developer put it.
 */
export async function findUpward(
  cwd: string,
  file: string,
  stopAt: string = homedir(),
): Promise<string | undefined> {
  for (const dir of ancestors(cwd, stopAt)) {
    if (await isOwnFile(join(dir, file))) {
      return dir;
    }
  }
  return undefined;
}

async function isOwnFile(path: string): Promise<boolean> {
  try {
    const { uid } = await stat(path);
    // Windows reports no uid; existence is all there is to check.
    return process.getuid === undefined || uid === process.getuid();
  } catch (error) {
    // Only a missing path means "not here". Local state that exists but
    // cannot be read is still the nearest one, and walking past it would
    // pick a parent's server or credential instead.
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
      return false;
    }
    throw new ZitadelError("E_VALIDATION", `${path} cannot be read`, {
      hint: `Check that ${path} and its directory are readable by you.`,
      details: { cause: errorMessage(error) },
    });
  }
}

/**
 * Whether two URLs name the same local server. `localhost` and the loopback
 * addresses are one host here: `start` records `localhost`, and a developer
 * may pass `--server http://127.0.0.1:8080` for the same process.
 */
export function sameLocalServer(a: string, b: string): boolean {
  try {
    const [left, right] = [new URL(a), new URL(b)];
    const sameHost =
      left.hostname === right.hostname ||
      (isLoopbackHost(left.hostname) && isLoopbackHost(right.hostname));
    return sameHost && left.protocol === right.protocol && left.port === right.port;
  } catch {
    return false;
  }
}

/**
 * How the server at `serverUrl` reaches this machine's loopback, judged by the
 * nearest runtime record: `allowed` when that record's process server got the
 * loopback allow list, `container` when it runs in Docker (its localhost is
 * the container), `unknown` for any other server or an unreadable record.
 */
export async function loopbackReach(
  cwd: string,
  serverUrl: string,
): Promise<"allowed" | "container" | "unknown"> {
  const nearest = await readNearestRuntimeMetadata(cwd).catch(() => {
    return undefined;
  });
  if (!nearest || !sameLocalServer(nearest.runtime.server_url, serverUrl)) {
    return "unknown";
  }
  if (nearest.runtime.backend === "docker") {
    return "container";
  }
  return Object.keys(LOCAL_DEFAULTS).every((name) => {
    return nearest.runtime.env?.injected.includes(name);
  })
    ? "allowed"
    : "unknown";
}

/** Runtime metadata of the server started in `cwd` or the nearest parent with one. */
export async function readNearestRuntimeMetadata(
  cwd: string,
): Promise<{ dir: string; runtime: RuntimeMetadata } | undefined> {
  const dir = await findUpward(cwd, LOCAL_RUNTIME_FILE);
  if (!dir) {
    return undefined;
  }
  const runtime = await readRuntimeMetadata(dir).catch((error: unknown) => {
    // A record in a parent is recovered where it is: the bare commands would
    // act on the working directory instead.
    throw dir === cwd ? error : retargetMalformedRuntime(error, dir);
  });
  return runtime ? { dir, runtime } : undefined;
}

/**
 * The runtime record when it can be read, `undefined` when it is missing or
 * malformed. For commands that only want a hint from it (the port a directory
 * had) before they report a malformed record themselves, with the fix.
 */
export async function peekRuntimeMetadata(cwd: string): Promise<RuntimeMetadata | undefined> {
  try {
    return await readRuntimeMetadata(cwd);
  } catch {
    return undefined;
  }
}

export async function readRuntimeMetadata(cwd: string): Promise<RuntimeMetadata | undefined> {
  const paths = localRuntimePaths(cwd);
  const raw = await readIfExists(paths.runtimeFile);
  if (raw === undefined) {
    return undefined;
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

/**
 * Whether the server at `serverUrl` is ready: `/readyz` answers once the
 * server's database does, so a server that started but cannot reach its
 * database is not healthy.
 */
export async function checkLocalServerHealth(
  serverUrl: string,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const readyUrl = new URL("/readyz", serverUrl);
    const response = await fetch(readyUrl, {
      headers: { "user-agent": userAgent() },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Only the status is wanted; the body is read to the end so the abort timer has
    // no stream left to abort.
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The error for a directory with no running server of its own. With a
 * `serverUrl` there is a record whose server is not running; without one there
 * is no record in the directory or a parent. The hint offers `--server` for the
 * case where someone really does mean another directory's server, since
 * nothing falls back to one on its own.
 */
export function localServerNotRunning(serverUrl?: string): ZitadelError {
  return new ZitadelError("E_LOCAL_SERVER_NOT_RUNNING", "Local Zitadel server is not running", {
    hint: serverUrl
      ? `No healthy local server responded at ${serverUrl}.`
      : "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
    nextCommands: [{ id: "start" }],
    details: { server_url: serverUrl },
  });
}

async function appendGitignoreEntry(cwd: string, entry: string): Promise<void> {
  const path = join(cwd, ".gitignore");
  const existing = (await readIfExists(path)) ?? "";

  const lines = existing.split(/\r?\n/).map((line) => {
    return line.trim();
  });
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
    env: isEnvSummary(input.env) ? input.env : undefined,
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

async function nearestExistingDirectory(path: string): Promise<string> {
  for (const current of ancestors(path)) {
    const info = await stat(current).catch((error: unknown) => {
      // Missing is the only miss to walk past, and the root has nothing above it.
      if (!isErrno(error, "ENOENT") || dirname(current) === current) {
        throw error;
      }
      return undefined;
    });
    if (info === undefined) {
      continue;
    }
    if (!info.isDirectory()) {
      throw new Error(`${current} exists but is not a directory`);
    }
    return current;
  }
  throw new Error(`${path} has no existing directory above it`);
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
    env: metadata.env ?? EMPTY_SUMMARY,
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
    nextCommands: [{ id: "reset", flags: { force: true } }, { id: "start" }],
    details: input,
  });
}

/**
 * The malformed-record error again, with its recovery aimed at `dir`. The
 * commands quote `dir` where it needs it, and `details.suggested_args` holds
 * the same arguments as they are.
 */
export function retargetMalformedRuntime(error: unknown, dir: string): unknown {
  if (!(error instanceof ZitadelError) || error.message !== `${LOCAL_RUNTIME_FILE} is malformed`) {
    return error;
  }
  const resetArgs = ["reset", "--force", "--cwd", dir];
  const startArgs = ["start", "--cwd", dir];
  return new ZitadelError(error.code, error.message, {
    hint: "Reset the local runtime, then start it again, each with the --cwd of the directory that holds it.",
    nextCommands: [
      { id: "reset", flags: { force: true, cwd: dir } },
      { id: "start", flags: { cwd: dir } },
    ],
    details: {
      ...(error.details as Record<string, unknown>),
      suggested_args: [resetArgs, startArgs],
    },
  });
}
