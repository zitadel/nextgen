import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isErrno } from "@/lib/errno";
import { isObject } from "@/lib/json";

import { SyncStateMalformedError } from "./errors";
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
 * @throws {@link SyncStateMalformedError} When the file is not JSON, or does
 *   not hold an object.
 * @throws {@link Error} When the file cannot be read, with the system's error:
 *   a missing file is `ENOENT`.
 */
export async function readState(cwd: string): Promise<StoredState> {
  const raw = await readFile(join(cwd, STATE_PATH), "utf8");
  const parsed = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new SyncStateMalformedError(STATE_PATH, "it is not valid JSON", { cause: error });
    }
  })();
  if (!isObject(parsed)) {
    throw new SyncStateMalformedError(STATE_PATH, "it does not hold an object");
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
 * @throws {@link SyncStateMalformedError} When the state file is not JSON, or
 *   an entry it holds for one of the paths is malformed.
 */
export async function publishedIds(
  cwd: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const state = await readState(cwd).catch((error: unknown) => {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  });
  const resources = state?.resources;
  if (resources === undefined) {
    return new Map();
  }
  if (!isObject(resources)) {
    throw new SyncStateMalformedError(STATE_PATH, "resources is not an object");
  }
  const entries = paths.flatMap((path): readonly (readonly [string, readonly string[]])[] => {
    const entry = resources[path];
    if (entry === undefined) {
      return [];
    }
    if (!isObject(entry)) {
      throw new SyncStateMalformedError(STATE_PATH, `resources["${path}"] is not an object`);
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
      throw new SyncStateMalformedError(
        STATE_PATH,
        `resources["${path}"] has an id that is not a non-empty string`,
      );
    }
    return [[path, valid]];
  });
  return new Map(entries);
}
