import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage, isErrno, ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";

import type { ScaffoldManifest, StoredState } from "./types.js";

export type { StoredState, ZitadelState } from "./types.js";

/**
 * Where the state file lives, relative to the project root.
 */
const STATE_PATH = ".zitadel/state.json";

/**
 * Read and parse `.zitadel/state.json`.
 *
 * @remarks
 * Callers run `zitadel setup` first to bring the file into existence. Only
 * the root is checked here: each section is narrowed by the code that reads
 * it, so a section this CLI does not know survives a rewrite.
 *
 * @param cwd - The project root.
 * @returns The file's sections, unchecked.
 * @throws {@link Error} When the file is missing, is not JSON, or does not
 *   hold an object.
 */
export async function readState(cwd: string): Promise<StoredState> {
  const raw = await readFile(join(cwd, STATE_PATH), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isObject(parsed)) {
    throw new Error(`${STATE_PATH} does not hold an object`);
  }
  return parsed;
}

/**
 * Replace the scaffold manifest section wholesale, preserving the rest of the
 * file.
 *
 * @remarks
 * Setup owns the full manifest (it knows exactly what it wrote); `doctor --fix`
 * re-writes it after restoring files. Kept here so state.json retains a single
 * writer module.
 *
 * @param cwd - The project root.
 * @param scaffold - The manifest to record.
 * @returns Nothing, once the file is written.
 * @throws {@link Error} When the file cannot be read or written.
 */
export async function updateScaffold(cwd: string, scaffold: ScaffoldManifest): Promise<void> {
  const current = await readState(cwd);
  const updated: StoredState = { ...current, scaffold };
  await writeFile(join(cwd, STATE_PATH), JSON.stringify(updated, null, 2));
}

/**
 * The platform ids some local files are known by, from `.zitadel/state.json`:
 * the id each was last synced as, and the one that replaced.
 *
 * @remarks
 * A flow left behind by an interrupted deploy may still name the replaced id,
 * so both count. A file never synced has no entry and no ids, and a missing
 * state file, or one without the `resources` section that only projects set
 * up before deploy published their files have, means nothing was synced.
 * Anything else that does not read as ids is refused: the state is the
 * authoritative record, and without it a flow is matched on a URL suffix,
 * which could pick one bound to another schema. Saying so beats editing the
 * wrong flow quietly.
 *
 * @param cwd - The project root.
 * @param paths - The project-relative paths of the files to look up.
 * @returns The ids, by path; a path with none is left out.
 * @throws {@link ZitadelError} With `E_VALIDATION` when the state file cannot
 *   be read or parsed, or an entry it holds for one of the paths is malformed.
 */
export async function publishedIds(
  cwd: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  try {
    const state = await readState(cwd);
    const resources = state.resources;
    if (resources === undefined) {
      return new Map();
    }
    if (!isObject(resources)) {
      throw new Error("resources is not an object");
    }
    const entries = paths.flatMap((path): readonly (readonly [string, readonly string[]])[] => {
      const entry = resources[path];
      if (entry === undefined) {
        return [];
      }
      if (!isObject(entry)) {
        throw new Error(`resources["${path}"] is not an object`);
      }
      const ids = [entry.id, entry.previousId].filter((id) => {
        return id !== undefined;
      });
      // An empty id is corrupt too: dropping it would fall back to URL
      // matching and could skip the flow pinned to the real published id.
      const valid = ids.filter((id): id is string => {
        return typeof id === "string" && id !== "";
      });
      if (valid.length !== ids.length) {
        throw new Error(`resources["${path}"] has an id that is not a non-empty string`);
      }
      return [[path, valid]];
    });
    return new Map(entries);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return new Map();
    }
    throw new ZitadelError("E_VALIDATION", `Cannot read ${STATE_PATH}: ${errorMessage(error)}`, {
      hint:
        "The file records which platform resource each local file was synced as. " +
        "Fix or remove it, then run this command again.",
      details: { file: STATE_PATH },
    });
  }
}
