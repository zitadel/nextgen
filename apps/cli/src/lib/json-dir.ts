import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "./errors";

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
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const result: Record<string, unknown>[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
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
    result.push(raw as Record<string, unknown>);
  }
  return result;
}
