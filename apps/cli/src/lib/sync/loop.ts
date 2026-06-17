import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

import { readState, removeFromState, updateState } from "./state.js";
import type { ResourceSyncer, SyncAction } from "./types.js";

/**
 * Compute the sync plan for `cwd` against the state file and (when
 * `fetchOld` is true) the platform API. The plan is read-only: it
 * decides what create/update/delete operations need to happen but
 * performs none of them. Pass it to {@link runSyncLoop} to execute.
 *
 * Validates every on-disk file (via `syncer.validate`) before planning any
 * work — a single malformed schema or flow aborts the whole run with
 * `E_VALIDATION` before any platform mutation. Both `plan` and `apply`
 * reach this code path.
 *
 * Bearer auth + base URL live in the api package's runtime registries
 * (`runtime/{auth,base-url}`). Callers set them once at command boot;
 * the sync engine doesn't carry a client.
 *
 * @param cwd      - Project root.
 * @param syncers  - Per-resource adapters. Order is preserved in the output.
 * @param fetchOld - When true, the planner fetches each delete/update target
 *   from the platform to populate `oldContent` for diff rendering.
 */
export async function buildSyncPlan(
  cwd: string,
  syncers: ReadonlyArray<ResourceSyncer>,
  fetchOld = false,
): Promise<ReadonlyArray<SyncAction>> {
  const state = await readState(cwd);
  const actions: SyncAction[] = [];

  for (const syncer of syncers) {
    const dirPath = join(cwd, syncer.directory);
    consola.debug(`scanning ${syncer.directory}`);
    const onDisk = await readJsonDir(dirPath);

    for (const content of onDisk.values()) {
      syncer.validate(content);
    }

    for (const [filePath, entry] of Object.entries(state.resources)) {
      if (!filePath.startsWith(syncer.directory)) {
        continue;
      }
      if (onDisk.has(join(cwd, filePath)) || !entry.id) {
        continue;
      }

      let oldContent: object | null = null;
      if (fetchOld && syncer.fetch) {
        try {
          oldContent = await syncer.fetch(entry.id);
        } catch (err) {
          consola.debug(`fetch ${syncer.kind} ${entry.id} failed:`, err);
        }
      }
      actions.push({ kind: "delete", path: filePath, syncer, id: entry.id, oldContent });
    }

    for (const [absPath, content] of onDisk.entries()) {
      const relPath = absPath.slice(cwd.length + 1);
      const entry = state.resources[relPath];
      const hash = hashResourceContent(content);

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
      if (fetchOld && syncer.fetch) {
        try {
          oldContent = await syncer.fetch(entry.id);
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
 * The platform target (base URL + bearer auth) lives in the api
 * package's runtime registries; callers set them before invoking this.
 *
 * @param cwd     - Project root.
 * @param syncers - Per-resource adapters; same list passed to
 *   `buildSyncPlan`.
 */
export async function runSyncLoop(
  cwd: string,
  syncers: ReadonlyArray<ResourceSyncer>,
): Promise<void> {
  const actions = await buildSyncPlan(cwd, syncers);

  for (const action of actions) {
    switch (action.kind) {
      case "create": {
        const id = await action.syncer.create(action.content);
        await updateState(cwd, action.path, { id, hash: action.hash });
        consola.info(
          `Created a new ${action.syncer.kind} on Zitadel from ${action.path} (id ${id})`,
        );
        break;
      }
      case "update": {
        await action.syncer.update(action.id, action.content);
        await updateState(cwd, action.path, { hash: action.hash });
        consola.info(`Updated the ${action.syncer.kind} on Zitadel from ${action.path}`);
        break;
      }
      case "delete": {
        await action.syncer.delete(action.id);
        await removeFromState(cwd, action.path);
        consola.info(
          `Deleted the ${action.syncer.kind} on Zitadel because ${action.path} was removed locally`,
        );
        break;
      }
      case "skip": {
        consola.debug(`Skipped ${action.path} (${action.reason})`);
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
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
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

export function hashResourceContent(data: object): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
