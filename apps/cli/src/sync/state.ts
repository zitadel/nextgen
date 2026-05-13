import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ResourceEntry = {
  id?: string;
  hash?: string;
};

export type ZitadelState = {
  framework: string;
  resources: Record<string, ResourceEntry>;
};

export async function readState(cwd: string): Promise<ZitadelState> {
  const raw = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
  return JSON.parse(raw) as ZitadelState;
}

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

export async function removeFromState(cwd: string, key: string): Promise<void> {
  const current = await readState(cwd);
  const { [key]: _removed, ...rest } = current.resources;
  const updated: ZitadelState = { ...current, resources: rest };
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify(updated, null, 2));
}
