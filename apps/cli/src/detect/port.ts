import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readPackageJson } from "./package-json";

export const DEFAULT_DEV_PORT = 3000;

export async function detectDevPort(cwd: string): Promise<number> {
  const fromScripts = await portFromScripts(cwd);
  if (fromScripts) return fromScripts;

  const fromEnvFile = await portFromEnvFile(cwd);
  if (fromEnvFile) return fromEnvFile;

  return DEFAULT_DEV_PORT;
}

async function portFromScripts(cwd: string): Promise<number | undefined> {
  const pkg = await readPackageJson(cwd).catch(() => undefined);
  const dev = pkg?.scripts?.dev;
  if (typeof dev !== "string") return undefined;
  return extractPort(dev);
}

async function portFromEnvFile(cwd: string): Promise<number | undefined> {
  for (const candidate of [".env.local", ".env"]) {
    try {
      const contents = await readFile(join(cwd, candidate), "utf8");
      const match = contents.match(/^\s*PORT\s*=\s*(\d+)/m);
      const rawPort = match?.[1];
      if (rawPort) return Number.parseInt(rawPort, 10);
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function extractPort(script: string): number | undefined {
  const inline = script.match(/-p\s+(\d+)|--port[=\s]+(\d+)/);
  if (inline) {
    const raw = inline[1] ?? inline[2];
    if (!raw) return undefined;
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const env = script.match(/(?:^|\s)PORT=(\d+)/);
  const rawEnvPort = env?.[1];
  if (rawEnvPort) return Number.parseInt(rawEnvPort, 10);
  return undefined;
}

export function issuerFromPort(port: number): string {
  return `http://localhost:${port}`;
}
