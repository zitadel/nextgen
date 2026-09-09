import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../errors";
import { isObject } from "../json";

const ZITADEL_DIR = ".zitadel";
/** CLI- and server-owned runtime state; never a resource, may be mid-write. */
const LOCAL_DIR = "local";
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const unique = (names: readonly string[]): string[] => [...new Set(names)].sort();

/**
 * Collects the environment variables a JSON document depends on, sorted and
 * de-duplicated. Recognises two reference styles: inline `${VAR}` interpolations
 * inside string values, and keys ending in `_env` whose value names a single
 * variable. `apply`/`plan` use it to fail before contacting the platform when
 * a required variable is absent; `start` unions it across the project
 * (`projectEnvRefs`) to decide which variables to hand the local runtime.
 */
export const envRefs = (value: unknown): string[] => unique(collect(value));

const collect = (node: unknown): readonly string[] => {
  if (typeof node === "string") {
    return [...node.matchAll(PLACEHOLDER)].map(([, name]) => name).filter(Boolean);
  }
  if (Array.isArray(node)) {
    return node.flatMap(collect);
  }
  if (isObject(node)) {
    return Object.entries(node).flatMap(([key, child]) =>
      key.endsWith("_env") && typeof child === "string" && VARIABLE_NAME.test(child)
        ? [child]
        : collect(child),
    );
  }
  return [];
};

/**
 * Every environment variable referenced by any JSON file under `.zitadel/`,
 * sorted and de-duplicated. `start` uses it to decide which variables to hand
 * the local runtime.
 *
 * Deliberately reads every `.json` file rather than the resource directories
 * the syncers own: `start` only looks names up, so scanning a file that is not
 * a resource costs one extra lookup at most, and a new resource kind is covered
 * the day its directory appears. Only `local/` is skipped, without entering
 * it: the runtime writes there while running. Extend the skip (`meta/`,
 * `state.json`) if another non-resource file ever produces false references.
 */
export const projectEnvRefs = async (cwd: string): Promise<string[]> => {
  const files = await jsonFiles(join(cwd, ZITADEL_DIR), [LOCAL_DIR]);
  const documents = await Promise.all(files.map(readJson));
  return unique(documents.flatMap(envRefs));
};

/**
 * Every `*.json` under `dir`, walking directories explicitly so `skip` entries
 * are never entered; a recursive `readdir` would enumerate the runtime's data
 * directory before it could be filtered out.
 */
const jsonFiles = async (dir: string, skip: readonly string[] = []): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (isObject(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return skip.includes(entry.name) ? [] : jsonFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return nested.flat();
};

const readJson = async (path: string): Promise<unknown> => {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new ZitadelError("E_VALIDATION", `${path} is not valid JSON`, {
      hint: "Fix or remove the file; every .json under .zitadel/ is read for variable references.",
      details: { path, message: error instanceof Error ? error.message : String(error) },
    });
  }
};
