import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../lib/errors";
import { parseJsonObject } from "../lib/json";

/**
 * Shape of the project secret persisted at `.zitadel/secret`. Holds the
 * project identity plus the credentials used to talk to the platform in
 * preview and production. Validated structurally by {@link readZitadelSecret}.
 */
export type ZitadelSecret = {
  project_id: string;
  project_secret: string;
  preview_secret: string;
  preview_origins: string[];
  created_at: string;
};

/**
 * Reads and parses `zitadel.json` into a plain object. Translates a missing
 * file into an actionable `E_VALIDATION` error pointing at `zitadel setup`;
 * other errors (e.g. malformed JSON) propagate unchanged.
 */
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

/**
 * Reads, parses, and structurally validates `.zitadel/secret`, returning it
 * as a {@link ZitadelSecret}. A missing file becomes an actionable
 * `E_VALIDATION` error pointing at `zitadel setup` / `zitadel doctor --fix`;
 * a present-but-incomplete file throws so callers never proceed with partial
 * credentials.
 */
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
