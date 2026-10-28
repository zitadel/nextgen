import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

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
export function credentialsPath(env: NodeJS.ProcessEnv): string {
  return join(telemetryConfigDir(env), "credentials.json");
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
  const file = await readFileOrEmpty(credentialsPath(env));
  return file.servers[new URL(server).origin];
}

/** Stores `login` for `server`, replacing any earlier one. */
export async function writeLogin(
  server: string,
  login: StoredLogin,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const path = credentialsPath(env);
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
