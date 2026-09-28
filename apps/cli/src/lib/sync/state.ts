import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ResourceEntry, ScaffoldManifest, ZitadelState } from "./types.js";

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
 * Merge an entry into the state file under `key`, preserving any
 * fields the caller did not override. Reads the file, writes it back
 * with sorted keys disabled (state is engine-managed, not human-
 * authored, so deterministic ordering isn't required here).
 */
export async function updateState(
  cwd: string,
  key: string,
  entry: ResourceEntry,
): Promise<void> {
  const current = await readState(cwd);
  const updated: ZitadelState = {
    ...current,
    resources: {
      ...current.resources,
      [key]: { ...current.resources[key], ...entry },
    },
  };
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(updated, null, 2));
}

/**
 * Replace the scaffold manifest section wholesale, preserving the sync
 * `resources`. Setup owns the full manifest (it knows exactly what it wrote);
 * `doctor --fix` re-writes it after restoring files. Kept here so state.json
 * retains a single writer module.
 */
export async function updateScaffold(cwd: string, scaffold: ScaffoldManifest): Promise<void> {
  const current = await readState(cwd);
  const updated: ZitadelState = { ...current, scaffold };
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(updated, null, 2));
}

/**
 * Remove an entry from the state file. No-op if the key is absent.
 */
export async function removeFromState(cwd: string, key: string): Promise<void> {
  const current = await readState(cwd);
  const { [key]: _removed, ...rest } = current.resources;
  const updated: ZitadelState = { ...current, resources: rest };
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(updated, null, 2));
}
