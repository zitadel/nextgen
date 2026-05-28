import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

import type { PlatformClient } from "../api/client.js";
import { readState, removeFromState, updateState } from "./state.js";
import type { ResourceSyncer } from "./syncers.js";

/**
 * One unit of work in a sync plan. The engine emits exactly one
 * `SyncAction` per resource file (or per state-only entry, for
 * deletes). Discriminated by `kind`.
 */
export type SyncAction =
  | { kind: "create"; path: string; syncer: ResourceSyncer; content: object; hash: string }
  | {
      kind: "update";
      path: string;
      syncer: ResourceSyncer;
      id: string;
      content: object;
      hash: string;
      oldContent: object | null;
    }
  | { kind: "delete"; path: string; syncer: ResourceSyncer; id: string; oldContent: object | null }
  | { kind: "skip"; path: string; reason: "immutable" | "no-change" };

/**
 * Compute the sync plan for `cwd` against the state file and (when
 * `client` is supplied) the platform API. The plan is read-only: it
 * decides what create/update/delete operations need to happen but
 * performs none of them. Pass it to {@link runSyncLoop} to execute.
 *
 * @param cwd     - Project root.
 * @param syncers - Per-resource adapters. Order is preserved in the output.
 * @param client  - Optional platform client; required only to populate
 *   `oldContent` on update/delete actions (for diff rendering).
 */
export async function buildSyncPlan(
  cwd: string,
  syncers: ReadonlyArray<ResourceSyncer>,
  client?: PlatformClient,
): Promise<ReadonlyArray<SyncAction>> {
  const state = await readState(cwd);
  const actions: SyncAction[] = [];

  for (const syncer of syncers) {
    const dirPath = join(cwd, syncer.directory);
    consola.debug(`scanning ${syncer.directory}`);
    const onDisk = await readJsonDir(dirPath);

    // Delete pass: in state but no longer on disk.
    for (const [filePath, entry] of Object.entries(state.resources)) {
      if (!filePath.startsWith(syncer.directory)) {
        continue;
      }
      if (onDisk.has(join(cwd, filePath)) || !entry.id) {
        continue;
      }

      let oldContent: object | null = null;
      if (client && syncer.fetch) {
        try {
          oldContent = await syncer.fetch(client, entry.id);
        } catch (err) {
          consola.debug(`fetch ${syncer.kind} ${entry.id} failed:`, err);
        }
      }
      actions.push({ kind: "delete", path: filePath, syncer, id: entry.id, oldContent });
    }

    // Create / update pass.
    for (const [absPath, content] of onDisk.entries()) {
      const relPath = absPath.slice(cwd.length + 1);
      const entry = state.resources[relPath];
      const hash = sha256(content);

      if (!entry?.id) {
        actions.push({ kind: "create", path: relPath, syncer, content, hash });
        continue;
      }

      if (!syncer.mutable) {
        actions.push({ kind: "skip", path: relPath, reason: "immutable" });
        continue;
      }

      if (entry.hash === hash) {
        actions.push({ kind: "skip", path: relPath, reason: "no-change" });
        continue;
      }

      let oldContent: object | null = null;
      if (client && syncer.fetch) {
        try {
          oldContent = await syncer.fetch(client, entry.id);
        } catch (err) {
          consola.debug(`fetch ${syncer.kind} ${entry.id} failed:`, err);
        }
      }
      actions.push({
        kind: "update",
        path: relPath,
        syncer,
        id: entry.id,
        content,
        hash,
        oldContent,
      });
    }
  }

  return actions;
}

/**
 * Execute every action returned by {@link buildSyncPlan} against the
 * platform. Updates the local state file (`.zitadel/state.json`) as
 * each action completes so an interrupted run can resume.
 *
 * @param cwd     - Project root.
 * @param client  - The platform client used for create/update/delete.
 * @param syncers - Per-resource adapters; same list passed to
 *   `buildSyncPlan`.
 */
export async function runSyncLoop(
  cwd: string,
  client: PlatformClient,
  syncers: ReadonlyArray<ResourceSyncer>,
): Promise<void> {
  const actions = await buildSyncPlan(cwd, syncers);

  for (const action of actions) {
    switch (action.kind) {
      case "create": {
        consola.info(`creating ${action.path}`);
        const id = await action.syncer.create(client, action.content);
        await updateState(cwd, action.path, { id, hash: action.hash });
        break;
      }
      case "update": {
        consola.info(`updating ${action.path} (hash changed)`);
        await action.syncer.update(client, action.id, action.content);
        await updateState(cwd, action.path, { hash: action.hash });
        break;
      }
      case "delete": {
        consola.info(`deleting ${action.path} (removed from disk)`);
        await action.syncer.delete(client, action.id);
        await removeFromState(cwd, action.path);
        break;
      }
      case "skip": {
        consola.debug(`skipping ${action.path} (${action.reason})`);
        break;
      }
    }
  }
}

async function readJsonDir(dirPath: string): Promise<Map<string, object>> {
  const result = new Map<string, object>();
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (err) {
    if (isErrnoCode(err, "ENOENT")) {
      return result;
    }
    throw err;
  }
  for (const entry of entries.filter((e) => e.endsWith(".json"))) {
    const filePath = join(dirPath, entry);
    const raw = await readFile(filePath, "utf8");
    result.set(filePath, JSON.parse(raw) as object);
  }
  return result;
}

function sha256(data: object): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}
