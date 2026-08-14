import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { InstanceHandle, PlatformCredentials } from "./types";

/**
 * The handshake file carries an InstanceHandle across process boundaries:
 * written by the script that boots + bootstraps the instance, read by
 * Playwright workers (fixtures) and the app dev-server wrapper.
 */
export async function writeHandshake(path: string, handle: InstanceHandle): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(handle, null, 2)}\n`, { mode: 0o600 });
}

export function readHandshakeSync(path: string): InstanceHandle {
  const contents = readFileSync(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`handshake file ${path} contains invalid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return validateHandle(value, path);
}

export async function waitForHandshake(path: string, timeoutMs = 60_000): Promise<InstanceHandle> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return validateHandle(JSON.parse(await readFile(path, "utf8")), path);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          `handshake file not readable within ${timeoutMs}ms: ${path} (${(error as Error).message})`,
          { cause: error },
        );
      }
      await sleep(250);
    }
  }
}

function validateHandle(value: unknown, source: string): InstanceHandle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`handshake file ${source} is not an object`);
  }
  const handle = value as Partial<InstanceHandle>;
  for (const field of ["baseUrl", "projectId", "projectSecret", "schemaId"] as const) {
    if (typeof handle[field] !== "string" || handle[field].length === 0) {
      throw new Error(`handshake file ${source} is missing "${field}"`);
    }
  }
  if (!URL.canParse(handle.baseUrl as string)) {
    throw new Error(`handshake file ${source} has a malformed "baseUrl": ${handle.baseUrl}`);
  }
  if (handle.platform !== undefined) {
    validatePlatform(handle.platform, source);
  }
  return handle as InstanceHandle;
}

/**
 * The handshake is the cross-process contract, so a malformed platform block
 * must fail here with the field name, not later with a less actionable error.
 */
function validatePlatform(value: unknown, source: string): void {
  const fail = (detail: string): never => {
    throw new Error(`handshake file ${source} has a malformed "platform" block: ${detail}`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("not an object");
  }
  const platform = value as Partial<PlatformCredentials>;
  for (const field of ["projectId", "publishableKey"] as const) {
    if (typeof platform[field] !== "string" || platform[field].length === 0) {
      fail(`"${field}" is required`);
    }
  }
  if (
    platform.platformKey !== undefined &&
    (typeof platform.platformKey !== "string" || platform.platformKey.length === 0)
  ) {
    fail(`"platformKey" must be a non-empty string when present`);
  }
  if (platform.operatorSession !== undefined) {
    const session = platform.operatorSession as Partial<
      NonNullable<PlatformCredentials["operatorSession"]>
    > | null;
    if (
      typeof session !== "object" ||
      session === null ||
      Array.isArray(session) ||
      typeof session.sessionToken !== "string" ||
      session.sessionToken.length === 0
    ) {
      fail(`"operatorSession" must carry a "sessionToken" when present`);
    }
  }
}
