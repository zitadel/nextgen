import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { InstanceHandle } from "./types";

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
  return validateHandle(JSON.parse(readFileSync(path, "utf8")), path);
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
  const handle = value as Partial<InstanceHandle> | null;
  for (const field of ["baseUrl", "projectId", "projectSecret", "schemaId"] as const) {
    if (typeof handle?.[field] !== "string" || handle[field].length === 0) {
      throw new Error(`handshake file ${source} is missing "${field}"`);
    }
  }
  if (!URL.canParse(handle.baseUrl as string)) {
    throw new Error(`handshake file ${source} has a malformed "baseUrl": ${handle.baseUrl}`);
  }
  return handle as InstanceHandle;
}
