import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "./errors";

/** One `*.json` file read by {@link readJsonDirEntries}: its file name and parsed body. */
export type JsonDirEntry = { name: string; body: Record<string, unknown> };

/**
 * Read every `*.json` file under `absDir` and return each body as a plain
 * object. Files are read in lexical filename order so the result is
 * deterministic for downstream hashing and diffs. Each file is parsed by
 * `JSON.parse`; this function does **not** apply any schema validation —
 * unknown keys, forward-compatible fields, and `${VAR}` placeholders survive
 * intact. Callers that need a typed shape pass the result through their
 * resource's Zod schema.
 *
 * Returns an empty array when the directory is missing. Throws `E_VALIDATION`
 * `ZitadelError` on invalid JSON or when a file's root value is not an object.
 *
 * @param absDir - Absolute path to the directory to scan.
 */
export async function readJsonDir(absDir: string): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await readJsonDirEntries(absDir)).map((entry) => entry.body);
}

/**
 * {@link readJsonDir}, keeping each body's file name — for callers that report
 * a problem against the file it came from. `skip` leaves out files by name
 * before they are read, so a file the caller does not own (a policy test file
 * beside the policies) can never fail it.
 */
export async function readJsonDirEntries(
  absDir: string,
  { skip }: { skip?: (name: string) => boolean } = {},
): Promise<ReadonlyArray<JsonDirEntry>> {
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const result: JsonDirEntry[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json") && !skip?.(name)).sort()) {
    const abs = join(absDir, entry);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(abs, "utf8"));
    } catch {
      throw new ZitadelError("E_VALIDATION", `${entry} is not valid JSON`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ZitadelError("E_VALIDATION", `${entry} must contain a JSON object at the root`);
    }
    result.push({ name: entry, body: raw as Record<string, unknown> });
  }
  return result;
}
