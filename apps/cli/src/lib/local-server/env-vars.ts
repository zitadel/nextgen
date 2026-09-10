/**
 * Dev-runtime secret join (issue #1049).
 *
 * Secrets the local runtime needs, such as a provider client secret, live in
 * the developer's env files, never in `.zitadel/`. When `zitadel start` spawns
 * the local server it reads `.env.local`, then `.env`, and hands every
 * `ZITADEL_*` variable to the runtime.
 *
 * Only that prefix crosses into the runtime; everything else in the env files
 * stays on disk. Values travel through the child's environment, never argv,
 * so they do not show up in `ps -ef`, and only names are recorded or printed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { ZitadelError } from "../errors";
import { isObject } from "../json";

/** Highest priority first. */
export const ENV_FILES = [".env.local", ".env"] as const;

/** Variables handed to the runtime: the `ZITADEL_` prefix, upper-case. */
export const ENV_PREFIX = "ZITADEL_";

/** What `runtime.json` and the `start`/`status` envelopes record: names only. */
export type EnvSummary = Readonly<{ injected: readonly string[] }>;

/** A summary plus the values themselves. Never serialise or log this. */
export type ResolvedEnv = EnvSummary & Readonly<{ values: Readonly<Record<string, string>> }>;

export const EMPTY_SUMMARY: EnvSummary = { injected: [] };
export const EMPTY_ENV: ResolvedEnv = { ...EMPTY_SUMMARY, values: {} };

/** True for an `env` block read back from `runtime.json`; names only. */
export const isEnvSummary = (value: unknown): value is EnvSummary =>
  isObject(value) &&
  Array.isArray(value.injected) &&
  value.injected.every((item) => typeof item === "string");

/** The serialisable half of a resolution: what the metadata file stores. */
export const envSummary = ({ injected }: EnvSummary): EnvSummary => ({ injected });

/**
 * Reads the project's env files into one map. Earlier files win, so a key in
 * `.env.local` shadows the same key in `.env`. Missing files are skipped.
 */
export const loadEnvFiles = async (
  cwd: string,
  files: readonly string[] = ENV_FILES,
): Promise<Readonly<Record<string, string>>> => {
  const parsed = await Promise.all(files.map((file) => readEnvFile(join(cwd, file))));
  return parsed.reduceRight((merged, source) => ({ ...merged, ...source }), {});
};

const readEnvFile = (path: string): Promise<Readonly<Record<string, string>>> =>
  readFile(path, "utf8").then(
    (contents) => parseEnv(contents.replace(/^\uFEFF/, "")),
    (error: unknown) => {
      if (isObject(error) && error.code === "ENOENT") {
        return {};
      }
      throw new ZitadelError("E_VALIDATION", `Cannot read ${path}`, {
        hint: "The file exists but could not be read; fix its permissions or remove it.",
        details: { path, message: error instanceof Error ? error.message : String(error) },
      });
    },
  );

/**
 * The `ZITADEL_*` variables from the project's env files, ready to hand to a
 * runtime. `start` calls this before it stops or spawns anything, so an
 * unreadable file fails fast and leaves a running runtime alone.
 */
export const loadProjectEnv = async (cwd: string): Promise<ResolvedEnv> => {
  const values = Object.fromEntries(
    Object.entries(await loadEnvFiles(cwd)).filter(
      ([name, value]) => name.startsWith(ENV_PREFIX) && value !== "",
    ),
  );
  return { values, injected: Object.keys(values).sort() };
};
