import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PackageJson } from "./package-json";

/**
 * Port assumed when no explicit dev port can be discovered. Matches Next.js's
 * own default so the inferred issuer URL lines up with `next dev`.
 */
export const DEFAULT_DEV_PORT = 3000;

/**
 * Determines the local dev-server port for `cwd`. The `dev` script is the most
 * authoritative source, then a `PORT` declaration in an env file, falling back
 * to {@link DEFAULT_DEV_PORT}. Used to derive the local issuer URL.
 */
export async function detectDevPort(cwd: string, pkg: PackageJson): Promise<number> {
  const dev = pkg.scripts?.dev;
  const fromScript = typeof dev === "string" ? extractPort(dev) : undefined;
  if (fromScript) {
    return fromScript;
  }

  const fromEnvFile = await portFromEnvFile(cwd);
  if (fromEnvFile) {
    return fromEnvFile;
  }

  return DEFAULT_DEV_PORT;
}

async function portFromEnvFile(cwd: string): Promise<number | undefined> {
  for (const candidate of [".env.local", ".env"]) {
    try {
      const contents = await readFile(join(cwd, candidate), "utf8");
      const match = contents.match(/^\s*PORT\s*=\s*(\d+)/m);
      const rawPort = match?.[1];
      if (rawPort) {
        return Number.parseInt(rawPort, 10);
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Parses a dev port out of an npm `dev` script string, recognizing both flag
 * forms (`-p`/`--port`) and a leading `PORT=` env assignment. Returns
 * `undefined` when no valid positive port is present so callers can fall back.
 */
export function extractPort(script: string): number | undefined {
  const inline = script.match(/-p\s+(\d+)|--port[=\s]+(\d+)/);
  if (inline) {
    const raw = inline[1] ?? inline[2];
    if (!raw) {
      return undefined;
    }
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  const env = script.match(/(?:^|\s)PORT=(\d+)/);
  const rawEnvPort = env?.[1];
  if (rawEnvPort) {
    return Number.parseInt(rawEnvPort, 10);
  }
  return undefined;
}

/**
 * Builds the local OIDC issuer URL for a given dev port. Centralized so the
 * `localhost` origin convention is defined in exactly one place.
 */
export function issuerFromPort(port: number): string {
  return `http://localhost:${port}`;
}
