/**
 * Dev-runtime secret join (issue #1049).
 *
 * The developer's env files configure the local server. When `zitadel start`
 * spawns it, the CLI reads `.env.local`, then `.env`, and hands every
 * `NEXTGEN_*` variable to the runtime: that is the server's own configuration
 * namespace (`server.data_dir` is `NEXTGEN_SERVER_DATA_DIR`, and so on). The
 * three keys the CLI sets itself, address, data dir and public base, are not
 * read from the files at all.
 *
 * On top of the files, the CLI adds `LOCAL_DEFAULTS`: settings a server on the
 * developer's machine needs and a deployed one must not have.
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

/** Variables handed to the runtime: the server's config prefix, upper-case. */
export const ENV_PREFIX = "NEXTGEN_";

/** Keys the CLI sets itself at spawn; a file may not set them, so they are not read. */
const CLI_OWNED = new Set([
  "NEXTGEN_SERVER_ADDRESS",
  "NEXTGEN_SERVER_DATA_DIR",
  "NEXTGEN_SERVER_PUBLIC_BASE",
]);

/**
 * Server settings a local runtime gets unless the developer sets them. A key
 * set in an env file or the shell wins, an empty value included, which is how
 * a default is turned off.
 *
 * `httpclient.allow_list` lets the server fetch from this machine's loopback
 * (ADR 061's supported development relaxation), so an identity provider on
 * `http://localhost:<port>` works as an SSO connection's issuer. The deny list
 * still blocks every other internal range.
 */
export const LOCAL_DEFAULTS: Readonly<Record<string, string>> = {
  NEXTGEN_HTTPCLIENT_ALLOW_LIST: "localhost,127.0.0.0/8,::1/128",
};

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
  return parsed.reduceRight<Record<string, string>>(
    (merged, source) => Object.assign(merged, source),
    {},
  );
};

const readEnvFile = async (path: string): Promise<Readonly<Record<string, string>>> => {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isObject(error) && error.code === "ENOENT") {
      return {};
    }
    throw new ZitadelError("E_VALIDATION", `Cannot read ${path}`, {
      hint: "The file exists but could not be read; fix its permissions or remove it.",
      details: { path, message: error instanceof Error ? error.message : String(error) },
    });
  }
  // parseEnv types values as possibly-undefined (it never emits them); drop them for the string map.
  return Object.fromEntries(
    Object.entries(parseEnv(contents.replace(/^\uFEFF/, ""))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
};

/**
 * The `NEXTGEN_*` variables from the project's env files, plus the
 * `LOCAL_DEFAULTS` neither the files nor `shell` set, ready to hand to a
 * runtime. `start` calls this before it stops or spawns anything, so an
 * unreadable file fails fast and leaves a running runtime alone.
 */
export const loadProjectEnv = async (
  cwd: string,
  shell: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ResolvedEnv> => {
  const declared = Object.entries(await loadEnvFiles(cwd)).filter(
    ([name]) => name.startsWith(ENV_PREFIX) && !CLI_OWNED.has(name),
  );
  const defaults = Object.entries(LOCAL_DEFAULTS).filter(
    ([name]) =>
      shell[name] === undefined && !declared.some(([declaredName]) => declaredName === name),
  );
  const values = Object.fromEntries([...defaults, ...declared.filter(([, value]) => value !== "")]);
  return { values, injected: Object.keys(values).sort() };
};
