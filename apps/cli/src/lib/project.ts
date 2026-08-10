import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "./errors";
import { isObject, parseJsonObject, stableStringify } from "./json";
import { DEFAULT_SERVER } from "./server";

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
  /**
   * When the project was attached to an owning team, recorded by
   * `zitadel claim`. Absent until then. The durable record lives on the
   * platform (the team's project grant); this is a local cache so commands can
   * answer "is this already attached?" without a round trip.
   */
  claimed_at?: string;
  /** The team that owns the project, recorded alongside {@link claimed_at}. */
  team_id?: string;
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
 * Writes `.zitadel/secret` back after a command mutated it (today only
 * `zitadel claim`, which records `claimed_at` and `team_id`).
 *
 * Atomic by construction: the bytes land in a sibling temp file that is
 * `chmod`ed and then `rename`d over the target, so a crash mid-write can never
 * leave a truncated or world-readable credentials file — the same
 * temp-then-rename the file-writer uses for managed files. Serialised with
 * {@link stableStringify} at mode `0600` to match exactly how setup's patcher
 * first wrote it, so a claim does not churn the file's formatting or loosen
 * the permissions `doctor` asserts.
 */
export async function writeZitadelSecret(cwd: string, secret: ZitadelSecret): Promise<void> {
  const path = join(cwd, ".zitadel/secret");
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${stableStringify(secret)}\n`, { mode: 0o600 });
  // `writeFile`'s mode is masked by the process umask, so re-assert it.
  await chmod(tmp, 0o600).catch(() => undefined);
  await rename(tmp, path);
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

/**
 * Reads the top-level `server` origin from a parsed `zitadel.json`, falling
 * back to {@link DEFAULT_SERVER} when the key is absent.
 *
 * Top-level only, unlike `resolveServer`, which prefers the selected
 * environment's `server` before falling back here. That is the point: an
 * environment override says where one invocation should talk, not where the
 * project lives. No practical difference today, since setup always writes a
 * concrete top-level `server`.
 *
 * This is the server the project actually lives on, which is not always the one
 * a command is talking to: `doctor` pins its own source to the local runtime URL
 * and `status --server local` overrides it. Anything reasoning about the
 * project itself (rather than about this invocation) has to read it from here.
 */
export function readProjectServer(config: Record<string, unknown>): string {
  return typeof config.server === "string" ? config.server : DEFAULT_SERVER;
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
