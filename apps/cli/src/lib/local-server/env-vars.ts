/**
 * Dev-runtime secret join (issue #1049).
 *
 * Project resources may reference environment variables by name: today a
 * `client_secret_env: "GOOGLE_CLIENT_SECRET"` key or a `${VAR}` placeholder;
 * the `${{ NAME }}` shape from ADR 061 lands with a scanner update. The value
 * never lives in configuration; it lives in the developer's env files. When `zitadel start` spawns the local server it resolves the declared
 * names from `.env.local`, then `.env`, then the CLI's own environment, and
 * hands only those variables to the runtime.
 *
 * Only declared names cross into the runtime; everything else in the env files
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

type EnvSource = Readonly<Record<string, string | undefined>>;

/** What `runtime.json` and the `start`/`status` envelopes record: names only. */
export type EnvSummary = Readonly<{
  /** Declared names that resolved, in declaration order. */
  injected: readonly string[];
  /** Declared names with no value in any source. */
  missing: readonly string[];
}>;

/** A summary plus the values themselves. Never serialise or log this. */
export type ResolvedEnv = EnvSummary & Readonly<{ values: Readonly<Record<string, string>> }>;

export const EMPTY_SUMMARY: EnvSummary = { injected: [], missing: [] };
export const EMPTY_ENV: ResolvedEnv = { ...EMPTY_SUMMARY, values: {} };

/**
 * Names a project file may reference but must never be allowed to set on the
 * spawned process: the loader and the CLI's own server settings. A checked-in
 * `.env` overriding `NODE_OPTIONS` would run code on `zitadel start`. Matched
 * case-insensitively because Windows treats `Path` and `PATH` as one variable.
 */
export const RESERVED_ENV = /^(PATH|NODE_OPTIONS|LD_.*|DYLD_.*|NEXTGEN_SERVER_.*)$/i;

/** True for an `env` block read back from `runtime.json`; names only. */
export const isEnvSummary = (value: unknown): value is EnvSummary =>
  isObject(value) &&
  [value.injected, value.missing].every(
    (list) => Array.isArray(list) && list.every((item) => typeof item === "string"),
  );

/** The serialisable half of a resolution: what the metadata file stores. */
export const envSummary = ({ injected, missing }: EnvSummary): EnvSummary => ({
  injected,
  missing,
});

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
 * Resolves each declared name against the sources in order; the first source
 * holding the name wins. Names are de-duplicated with order preserved, an
 * empty value counts as unset (as `plan` treats it), and reserved names are
 * dropped rather than resolved.
 */
export const resolveEnvNames = (
  names: readonly string[],
  sources: readonly EnvSource[],
): ResolvedEnv => {
  const isSet = (source: EnvSource, name: string) =>
    Object.hasOwn(source, name) && source[name] !== undefined && source[name] !== "";
  const lookup = (name: string) => sources.find((source) => isSet(source, name))?.[name];
  const found = [...new Set(names)]
    .filter((name) => !RESERVED_ENV.test(name))
    .map((name) => [name, lookup(name)] as const);
  const present = found.filter(
    (entry): entry is readonly [string, string] => entry[1] !== undefined,
  );
  return {
    values: Object.fromEntries(present),
    injected: present.map(([name]) => name),
    missing: found.filter(([, value]) => value === undefined).map(([name]) => name),
  };
};

/**
 * Resolves the names the project's files reference (see `projectEnvRefs`)
 * from the env files, then the CLI's own environment. `start` calls this
 * before it stops or spawns anything, so a bad file fails fast and leaves a
 * running runtime alone.
 */
export const loadProjectEnv = async (
  cwd: string,
  names: readonly string[],
  processEnv: EnvSource = process.env,
): Promise<ResolvedEnv> =>
  names.length === 0 ? EMPTY_ENV : resolveEnvNames(names, [await loadEnvFiles(cwd), processEnv]);

/** One warning per declared name that had no value at spawn. Names only. */
export const envWarnings = ({ missing }: EnvSummary): readonly string[] =>
  missing.map(
    (name) =>
      `${name} is referenced by the project but not set in ${ENV_FILES.join(", ")} or the environment; add it, then run \`zitadel stop\` and \`zitadel start\`.`,
  );
