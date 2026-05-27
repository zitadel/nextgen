import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * One row in the local state file: the platform `id` returned at
 * create time and the content `hash` last successfully synced. Both
 * fields are optional so the engine can recover from partial writes.
 */
type ResourceEntry = {
  id?: string;
  hash?: string;
};

/**
 * The persisted contents of `.zitadel/state.json`. Maps each managed
 * file path (relative to the project root) to its sync entry, plus
 * the framework id captured during `zitadel setup`.
 */
export type ZitadelState = {
  framework: string;
  resources: Record<string, ResourceEntry>;
};

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
 * Remove an entry from the state file. No-op if the key is absent.
 */
export async function removeFromState(cwd: string, key: string): Promise<void> {
  const current = await readState(cwd);
  const { [key]: _removed, ...rest } = current.resources;
  const updated: ZitadelState = { ...current, resources: rest };
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(updated, null, 2));
}
