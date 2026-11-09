import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage, isErrno, ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";

import type { ScaffoldManifest, ZitadelState } from "./types.js";

export type { ZitadelState } from "./types.js";

/**
 * Read and parse `.zitadel/state.json`. Throws if the file is
 * missing or malformed; callers run `zitadel setup` first to bring
 * the file into existence.
 */
export async function readState(cwd: string): Promise<ZitadelState> {
  const raw = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
  return JSON.parse(raw) as ZitadelState;
}

/**
 * Replace the scaffold manifest section wholesale, preserving the rest of the
 * file. Setup owns the full manifest (it knows exactly what it wrote);
 * `doctor --fix` re-writes it after restoring files. Kept here so state.json
 * retains a single writer module.
 *
 * @param cwd - The project root.
 * @param scaffold - The manifest to record.
 */
export async function updateScaffold(cwd: string, scaffold: ScaffoldManifest): Promise<void> {
  const current = await readState(cwd);
  const updated: ZitadelState = { ...current, scaffold };
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(updated, null, 2));
}

/**
 * The platform ids some local files are known by, from `.zitadel/state.json`:
 * the id each was last synced as, and the one that replaced.
 *
 * @remarks
 * A flow left behind by an interrupted deploy may still name the replaced id,
 * so both count. A file never synced has no entry and no ids, and a missing
 * state file, or one without the `resources` section that only projects set
 * up before deploy published their files have, means nothing was synced. Anything else that does not read as
 * ids is refused: the state is the authoritative record, and without it a
 * flow is matched on a URL suffix, which could pick one bound to another
 * schema. Saying so beats editing the wrong flow quietly.
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
    const state: unknown = await readState(cwd);
    if (!isObject(state)) {
      throw new Error("it is not an object");
    }
    if (state.resources === undefined) {
      return new Map();
    }
    if (!isObject(state.resources)) {
      throw new Error("resources is not an object");
    }
    const resources = state.resources;
    const entries = paths.flatMap((path): Array<[string, string[]]> => {
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
    throw new ZitadelError(
      "E_VALIDATION",
      `Cannot read .zitadel/state.json: ${errorMessage(error)}`,
      {
        hint:
          "The file records which platform resource each local file was synced as. " +
          "Fix or remove it, then run this command again.",
        details: { file: ".zitadel/state.json" },
      },
    );
  }
}
