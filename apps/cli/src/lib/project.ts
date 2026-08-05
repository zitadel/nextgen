import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "./errors";
import { isObject, parseJsonObject } from "./json";

/**
 * Reports whether `cwd` has already been initialized, i.e. a committed
 * `zitadel.json` exists. Used to decide whether setup should run or skip.
 */
export async function hasZitadelConfig(cwd: string): Promise<boolean> {
  return exists(join(cwd, "zitadel.json"));
}

/**
 * Reports whether local secret material (`.zitadel/secret`) is present. Gates
 * commands that need credentials, and signals that secrets were already pulled.
 */
export async function hasZitadelSecret(cwd: string): Promise<boolean> {
  return exists(join(cwd, ".zitadel/secret"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

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

/**
 * Reads the configured renderer id from a parsed `zitadel.json`, normalising the
 * legacy `default` alias to `react` and falling back to `react` when unset. The
 * value is validated downstream by `getRenderer`, so callers need not re-check.
 */
export function readRendererId(config: Record<string, unknown>): string {
  const branding = isObject(config.branding) ? config.branding : undefined;
  const value = branding && typeof branding.renderer === "string" ? branding.renderer : "react";
  return value === "default" ? "react" : value;
}

/**
 * Reads the recorded sign-in preset from a parsed `zitadel.json`, if present.
 * Setup persists it (see the patcher's `projectConfig`); absent means
 * password-first per the setup default.
 */
export function readPreset(config: Record<string, unknown>): string | undefined {
  return typeof config.preset === "string" ? config.preset : undefined;
}

/**
 * Reads the recorded use case from a parsed `zitadel.json`, if present.
 * Guidance-only, like the field itself — behavior lives in the generated
 * schema/flow files.
 */
export function readUseCase(config: Record<string, unknown>): string | undefined {
  return typeof config.useCase === "string" ? config.useCase : undefined;
}

/** Reads `environments.development.issuer` from a parsed `zitadel.json`, if present. */
export function readDevelopmentIssuer(config: Record<string, unknown>): string | undefined {
  if (isObject(config.environments) && isObject(config.environments.development)) {
    const issuer = config.environments.development.issuer;
    return typeof issuer === "string" ? issuer : undefined;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
