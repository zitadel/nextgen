import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ZitadelError } from "../lib/errors";
import { parseJsonObject, stableStringify } from "../lib/json";

export type ZitadelSecret = {
  project_id: string;
  project_secret: string;
  preview_secret: string;
  preview_origins: string[];
  created_at: string;
};

export async function readZitadelConfig(cwd: string): Promise<Record<string, unknown>> {
  try {
    return parseJsonObject(await readFile(join(cwd, "zitadel.json"), "utf8"), "zitadel.json");
  } catch (error) {
    if (isNotFound(error)) {
      throw new ZitadelError("E_VALIDATION", "zitadel.json was not found", {
        hint: "Run `zitadel setup` first.",
        nextCommands: ["zitadel setup"],
      });
    }
    throw error;
  }
}

export async function readZitadelSecret(cwd: string): Promise<ZitadelSecret> {
  try {
    const secret = parseJsonObject(
      await readFile(join(cwd, ".zitadel/secret"), "utf8"),
      ".zitadel/secret",
    );
    if (
      typeof secret.project_id !== "string" ||
      typeof secret.project_secret !== "string" ||
      typeof secret.preview_secret !== "string" ||
      !Array.isArray(secret.preview_origins)
    ) {
      throw new Error(".zitadel/secret is missing required fields");
    }
    return secret as ZitadelSecret;
  } catch (error) {
    if (isNotFound(error)) {
      throw new ZitadelError("E_VALIDATION", ".zitadel/secret was not found", {
        hint: "Run `zitadel setup` first, or restore the project secret with `zitadel doctor --fix`.",
        nextCommands: ["zitadel setup", "zitadel doctor --fix"],
      });
    }
    throw error;
  }
}

export async function writeZitadelSecret(cwd: string, secret: ZitadelSecret): Promise<void> {
  const path = join(cwd, ".zitadel/secret");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${stableStringify(secret)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => undefined);
  await rename(tmp, path);
}

export function schemaVersionFromConfig(config: Record<string, unknown>): string {
  const schema = typeof config.$schema === "string" ? config.$schema : "";
  const match = schema.match(/\/v([^/]+)\//);
  return match?.[1] ?? "2.0";
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
