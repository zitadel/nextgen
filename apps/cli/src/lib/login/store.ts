import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { isErrno, ZitadelError } from "../errors";
import { telemetryConfigDir } from "../telemetry/identity";

/** A developer's sign-in at one server, as `zitadel login` stores it. */
export type StoredLogin = {
  issuer: string;
  client_id: string;
  /** The API the tokens are for: the platform API's identifier. */
  resource: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  access_token: string;
  /** ISO 8601. */
  access_token_expires_at: string;
  refresh_token?: string;
  user: { id: string; identifier?: string };
  signed_in_at: string;
};

type CredentialsFile = {
  version: 1;
  /** Keyed by server origin. */
  servers: Record<string, StoredLogin>;
};

/**
 * Where sign-ins are kept: the CLI's user config directory, never a project
 * tree, so no commit can carry them. The file and its directory are the
 * owner's alone.
 */
export function credentialsPath(env: NodeJS.ProcessEnv): string | undefined {
  const dir = telemetryConfigDir(env);
  return dir === undefined ? undefined : join(dir, "credentials.json");
}

async function readFileOrEmpty(path: string): Promise<CredentialsFile> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as CredentialsFile;
    if (parsed?.version === 1 && typeof parsed.servers === "object" && parsed.servers !== null) {
      return parsed;
    }
  } catch {}
  return { version: 1, servers: {} };
}

/** The sign-in stored for `server`, if any. */
export async function readLogin(
  server: string,
  env: NodeJS.ProcessEnv,
): Promise<StoredLogin | undefined> {
  const path = credentialsPath(env);
  if (path === undefined) {
    return undefined;
  }
  const file = await readFileOrEmpty(path);
  return file.servers[new URL(server).origin];
}

/** Stores `login` for `server`, replacing any earlier one. */
export async function writeLogin(
  server: string,
  login: StoredLogin,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const path = credentialsPath(env);
  if (path === undefined) {
    throw new ZitadelError("E_VALIDATION", "There is no config directory to keep the sign-in in.", {
      hint: "Set XDG_CONFIG_HOME to a directory you own, then sign in again.",
    });
  }
  const file = await readFileOrEmpty(path);
  file.servers[new URL(server).origin] = login;
  await writePrivate(path, file);
}

/** Forgets the sign-in for `server`, returning what was stored. */
export async function removeLogin(
  server: string,
  env: NodeJS.ProcessEnv,
): Promise<StoredLogin | undefined> {
  const path = credentialsPath(env);
  if (path === undefined) {
    return undefined;
  }
  const file = await readFileOrEmpty(path);
  const origin = new URL(server).origin;
  const removed = file.servers[origin];
  if (removed === undefined) {
    return undefined;
  }
  delete file.servers[origin];
  if (Object.keys(file.servers).length === 0) {
    await rm(path, { force: true });
  } else {
    await writePrivate(path, file);
  }
  return removed;
}

/**
 * How old the lock beside the sign-ins may grow before another run takes it
 * over. A run holds it for one refresh, which gives up sooner, so an older
 * lock was left by a run that died holding it.
 */
export const STALE_LOCK_MS = 30_000;

/**
 * Runs `task` as the only run of the CLI that refreshes a sign-in, so no two
 * runs present one refresh token: the server answers its second presentation
 * by revoking every token of the consent (ADR 037). The lock is a file beside
 * the sign-ins, created exclusively; a run waits for it with a short backoff
 * until `signal` aborts, and takes over one older than {@link STALE_LOCK_MS}.
 */
export async function withLoginLock<T>(
  env: NodeJS.ProcessEnv,
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const path = credentialsPath(env);
  if (path === undefined) {
    return task();
  }
  const lock = `${path}.lock`;
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  for (let backoff = 10; !(await createExclusive(lock)); backoff = Math.min(backoff * 2, 250)) {
    signal?.throwIfAborted();
    if (await isStale(lock)) {
      await clearStale(lock);
    }
    await sleep(backoff);
  }
  try {
    return await task();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * Removes a lock its run left behind. Two runs that both found it stale must
 * not both remove it, or the second removes the lock the first took
 * meanwhile, so removing it is exclusive too (a second file, created the same
 * way), and its age is read again once that is held.
 */
async function clearStale(lock: string): Promise<void> {
  const guard = `${lock}.clearing`;
  if (!(await createExclusive(guard))) {
    // A run that died clearing it left its guard, which goes stale the same way.
    if (await isStale(guard)) {
      await rm(guard, { force: true });
    }
    return;
  }
  try {
    if (await isStale(lock)) {
      await rm(lock, { force: true });
    }
  } finally {
    await rm(guard, { force: true });
  }
}

/** Creates `path` unless it exists, which only one run can do: whether this one did. */
async function createExclusive(path: string): Promise<boolean> {
  try {
    await writeFile(path, "", { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
}

/** Whether `path` is older than {@link STALE_LOCK_MS}; not once it is gone. */
async function isStale(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

/**
 * Writes beside the file and renames into place, so a concurrent reader sees
 * the old file or the new one, and `0600` from the first byte.
 */
async function writePrivate(path: string, file: CredentialsFile): Promise<void> {
  const dir = join(path, "..");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const staging = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(staging, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(staging, 0o600);
  await rename(staging, path);
}
