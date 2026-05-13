import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

import type { PlatformClient } from "../platform/client.js";
import { readState, removeFromState, updateState } from "./state.js";
import type { ResourceSyncer } from "./syncers.js";

async function readJsonDir(dirPath: string): Promise<Map<string, object>> {
  const result = new Map<string, object>();
  try {
    const entries = await readdir(dirPath);
    for (const entry of entries.filter((e) => e.endsWith(".json"))) {
      const filePath = join(dirPath, entry);
      const raw = await readFile(filePath, "utf8");
      result.set(filePath, JSON.parse(raw) as object);
    }
  } catch {
    // directory doesn't exist — return empty map
  }
  return result;
}

function sha256(data: object): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export async function runSyncLoop(
  cwd: string,
  client: PlatformClient,
  syncers: ResourceSyncer[],
): Promise<void> {
  const state = await readState(cwd);

  for (const syncer of syncers) {
    const dirPath = join(cwd, syncer.directory);
    consola.debug(`scanning ${syncer.directory}`);
    const onDisk = await readJsonDir(dirPath);

    for (const [filePath, entry] of Object.entries(state.resources)) {
      if (!filePath.startsWith(syncer.directory)) {
        continue;
      }
      if (!onDisk.has(join(cwd, filePath)) && entry.id) {
        consola.info(`deleting ${filePath} (removed from disk)`);
        await syncer.delete(client, entry.id);
        await removeFromState(cwd, filePath);
      }
    }

    for (const [absPath, data] of onDisk.entries()) {
      const relPath = absPath.slice(cwd.length + 1);
      const entry = state.resources[relPath];
      const hash = sha256(data);

      if (!entry?.id) {
        consola.info(`creating ${relPath}`);
        const id = await syncer.create(client, data);
        await updateState(cwd, relPath, { id, hash });
        continue;
      }

      if (!syncer.mutable) {
        consola.debug(`skipping ${relPath} (immutable)`);
        continue;
      }

      if (entry.hash === hash) {
        consola.debug(`skipping ${relPath} (no change)`);
        continue;
      }

      consola.info(`updating ${relPath} (hash changed)`);
      await syncer.update(client, entry.id, data);
      await updateState(cwd, relPath, { hash });
    }
  }
}
