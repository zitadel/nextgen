import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { consola } from "consola";

import { ZitadelError } from "../errors";
import { FLOWS_DIR } from "../flows";
import { stableStringify } from "../json";
import { annotateAssetWarnings } from "./asset-probe.js";
import { validatePlannedFlows } from "./flow-validation.js";
import type { PlanResourceChange } from "./plan-renderer.js";
import { readState, removeFromState, updateState } from "./state.js";
import type { ResourceEntry, ResourceSyncer, SyncAction } from "./types.js";

/**
 * Compute the sync plan for `cwd` against the state file and (when
 * `fetchOld` is true) the platform API. The plan is read-only: it
 * decides what create/update/revise/delete operations need to happen but
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

  // Walk local flow files once, up front: revisioned schemas need to name every
  // flow whose `user_schema` currently pins the previous revision, so the
  // executor can re-pin those flows after the new revision is published.
  const localFlows = await readLocalFlowUserSchemas(cwd);

  // Revisions this plan will publish, keyed by the superseded id. Schema
  // syncers run before the flow syncer (makeSyncers order), so every pending
  // revise is known by the time flow files are planned.
  const pendingRevisions = new Map<string, { schemaPath: string }>();

  // Revisions an interrupted earlier run already published (state advanced,
  // `previousId` recorded) whose flows were never rewritten: superseded id →
  // the concrete new id. Lets a rerun finish the re-pin with no new revise.
  const recoveredRevisions = new Map<string, { schemaPath: string; newId: string }>();
  for (const [schemaPath, entry] of Object.entries(state.resources)) {
    if (entry.previousId && entry.id && entry.previousId !== entry.id) {
      recoveredRevisions.set(entry.previousId, { schemaPath, newId: entry.id });
    }
  }

  // Every scanned file body, keyed by project-relative path. Schema syncers
  // run before the flow syncer, so by the time a re-pin is planned the new
  // schema revision's content is available for the pre-flight field check.
  const scannedContents = new Map<string, object>();

  for (const syncer of syncers) {
    const dirPath = join(cwd, syncer.directory);
    consola.debug(`scanning ${syncer.directory}`);
    const onDisk = await readJsonDir(dirPath);

    // A singleton syncer owns exactly one descriptor file. Failing on extras
    // beats scanning them: a stray copy (branding.backup.json) would
    // otherwise be published as one more live revision.
    if (syncer.singletonFile) {
      for (const absPath of onDisk.keys()) {
        const name = basename(absPath);
        if (name !== syncer.singletonFile) {
          throw new ZitadelError(
            "E_VALIDATION",
            `unexpected file in ${syncer.directory}: ${name}`,
            {
              hint:
                `${syncer.kind} is a singleton resource — keep exactly one descriptor at ` +
                `${syncer.directory}/${syncer.singletonFile} and move other .json files ` +
                `out of the directory (each scanned descriptor would publish as its own revision).`,
            },
          );
        }
      }
    }

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
      scannedContents.set(relPath, content);
      const entry = state.resources[relPath];
      const hash = hashForState(syncer, content);

      // A flow pinned to a schema revision superseded in this plan (or by an
      // interrupted earlier run) needs its `user_schema` rewritten — whether
      // the flow is untouched, edited, or brand new (a create in the same
      // run as the revise must not POST the stale id).
      const flowRef = localFlows.get(relPath);
      const pending = flowRef ? pendingRevisions.get(flowRef) : undefined;
      const recovered = flowRef ? recoveredRevisions.get(flowRef) : undefined;
      const repin = pending
        ? { previousId: flowRef as string, schemaPath: pending.schemaPath }
        : recovered
          ? {
              previousId: flowRef as string,
              schemaPath: recovered.schemaPath,
              newId: recovered.newId,
            }
          : undefined;

      if (!entry?.id) {
        actions.push({
          kind: "create",
          path: relPath,
          syncer,
          content,
          hash,
          ...(repin ? { repin } : {}),
        });
        continue;
      }

      // State files written before normalized hashing hold legacy hashes
      // (order-sensitive, un-normalized). Accepting the legacy format —
      // both over the raw file and over its stably-sorted form, since
      // setup-era hashes were computed on sorted keys — keeps an untouched
      // or merely reordered file a skip; a spurious mismatch here would
      // publish a garbage schema revision. Writes always store the new
      // format, so state converges on the next real change.
      const unchanged =
        entry.hash === hash ||
        entry.hash === hashResourceContent(content) ||
        entry.hash === hashResourceContent(JSON.parse(stableStringify(content)) as object);
      if (unchanged && !(repin && syncer.mutable)) {
        actions.push({ kind: "skip", path: relPath, reason: "no-change" });
        continue;
      }

      if (syncer.revisioned) {
        const oldContent = await fetchOldIfAsked(syncer, entry.id, fetchOld);
        pendingRevisions.set(entry.id, { schemaPath: relPath });
        actions.push({
          kind: "revise",
          path: relPath,
          syncer,
          content,
          hash,
          previousId: entry.id,
          oldContent,
          affectedPaths: findFlowsPinnedTo(entry.id, localFlows),
        });
        continue;
      }

      if (!syncer.mutable) {
        actions.push({ kind: "skip", path: relPath, reason: "immutable" });
        continue;
      }

      const oldContent = await fetchOldIfAsked(syncer, entry.id, fetchOld);
      actions.push({
        kind: "update",
        path: relPath,
        syncer,
        id: entry.id,
        content,
        hash,
        oldContent,
        ...(repin ? { repin } : {}),
      });
    }
  }

  // Semantic pre-flight over every flow this plan uploads — the rules the
  // server would otherwise enforce mid-apply, after the schema revision
  // already published. Throws E_VALIDATION before any mutation.
  validatePlannedFlows({ actions, scannedContents, stateResources: state.resources });

  // Reachability pre-flight for branding asset URLs. Annotates warnings only:
  // the machine planning is not necessarily the machine rendering the login
  // page, so a URL this host cannot fetch is never a reason to fail.
  await annotateAssetWarnings(actions);

  return actions;
}

/** Result of {@link runSyncLoop}: what changed on the platform and locally. */
export type SyncLoopResult = {
  /**
   * Project-relative paths of files updated from the server's canonical
   * responses (write-back). Surfaced in human and `--json` output so a
   * local rewrite is never silent.
   */
  filesUpdated: string[];
  /**
   * The platform resources this run touched, in execution order. Unlike a
   * plan-time enumeration, `id` carries the resulting platform id (the
   * created id, the newly published revision id, or the id updated or
   * deleted). Feeds the `apply` `--json` `changes` array.
   */
  applied: PlanResourceChange[];
};

/**
 * Execute every action returned by {@link buildSyncPlan} against the
 * platform. Updates the local state file (`.zitadel/state.json`) as
 * each action completes so an interrupted run can resume. After each
 * mutation, the server's canonical body is written back to the local
 * file (when it differs in normalized form), so repo config matches
 * live state by construction and the next `plan` is empty.
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
): Promise<SyncLoopResult> {
  const actions = await buildSyncPlan(cwd, syncers);
  for (const action of actions) {
    if (action.kind === "create" || action.kind === "update" || action.kind === "revise") {
      for (const warning of action.warnings ?? []) {
        consola.warn(`${action.path}: ${warning.message}`);
      }
    }
  }
  const filesUpdated: string[] = [];
  const applied: PlanResourceChange[] = [];
  // Revisions published by this run: superseded id → new id. Update actions
  // carrying a `repin` patch their `user_schema` from here.
  const repinned = new Map<string, string>();

  const writeBack = async (
    action: Extract<SyncAction, { kind: "create" | "revise" | "update" }>,
    canonical: object | undefined,
    fallbackHash: string,
  ): Promise<string> => {
    if (!canonical) {
      return fallbackHash;
    }
    const { hash, changed } = await writeBackResource(cwd, action.path, action.syncer, canonical);
    if (changed) {
      filesUpdated.push(action.path);
      consola.info(`Updated ${action.path} from the server's canonical response`);
    }
    return hash;
  };

  for (const action of actions) {
    switch (action.kind) {
      case "create": {
        let content = action.content;
        const newId = action.repin
          ? (repinned.get(action.repin.previousId) ?? action.repin.newId)
          : undefined;
        if (newId) {
          // A flow created in the same run as (or after an interrupted)
          // schema revise must adopt the new revision — POSTing the stale
          // pin would fail validation, and its canonical echo would revert
          // the re-pinned local file.
          content = { ...(content as Record<string, unknown>), user_schema: newId };
        }
        const { id, canonical } = await action.syncer.create(content);
        const fallbackHash = newId ? hashForState(action.syncer, content) : action.hash;
        const entry: ResourceEntry = { id, hash: await writeBack(action, canonical, fallbackHash) };
        await updateState(cwd, action.path, entry);
        consola.info(
          `Created a new ${action.syncer.kind} on Zitadel from ${action.path} (id ${id})`,
        );
        applied.push({ kind: action.syncer.kind, action: "create", file: action.path, id });
        break;
      }
      case "revise": {
        const { id, canonical } = await action.syncer.create(action.content);
        // `previousId` lands in state before the flow files are rewritten:
        // if the process dies in between, the next plan recovers the re-pin
        // from state instead of publishing a duplicate revision.
        const entry: ResourceEntry = {
          id,
          hash: await writeBack(action, canonical, action.hash),
          previousId: action.previousId,
        };
        await updateState(cwd, action.path, entry);
        repinned.set(action.previousId, id);
        consola.info(
          `Published a new ${action.syncer.kind} revision on Zitadel from ${action.path} (id ${id})`,
        );
        for (const flowPath of action.affectedPaths) {
          if (await repinFlowFile(cwd, flowPath, action.previousId, id)) {
            filesUpdated.push(flowPath);
            consola.info(`Re-pinned user_schema in ${flowPath} to ${id}`);
          }
        }
        applied.push({
          kind: action.syncer.kind,
          action: "revision",
          file: action.path,
          id,
          previous_id: action.previousId,
        });
        break;
      }
      case "update": {
        let content = action.content;
        const newId = action.repin
          ? (repinned.get(action.repin.previousId) ?? action.repin.newId)
          : undefined;
        if (newId && action.repin) {
          // The plan captured the flow before the revise rewrote its file;
          // patch the pin in memory so the wire request adopts the new
          // revision without re-reading disk. The file rewrite below is a
          // no-op when this run's revise already re-pinned it — it matters
          // for crash recovery, where no revise ran this time.
          content = { ...(content as Record<string, unknown>), user_schema: newId };
          if (await repinFlowFile(cwd, action.path, action.repin.previousId, newId)) {
            filesUpdated.push(action.path);
            consola.info(`Re-pinned user_schema in ${action.path} to ${newId}`);
          }
        }
        const { canonical } = await action.syncer.update(action.id, content);
        const fallbackHash = newId ? hashForState(action.syncer, content) : action.hash;
        await updateState(cwd, action.path, {
          hash: await writeBack(action, canonical, fallbackHash),
        });
        consola.info(`Updated the ${action.syncer.kind} on Zitadel from ${action.path}`);
        applied.push({ kind: action.syncer.kind, action: "update", file: action.path, id: action.id });
        break;
      }
      case "delete": {
        await action.syncer.delete(action.id);
        await removeFromState(cwd, action.path);
        consola.info(
          `Deleted the ${action.syncer.kind} on Zitadel because ${action.path} was removed locally`,
        );
        applied.push({ kind: action.syncer.kind, action: "delete", file: action.path, id: action.id });
        break;
      }
      case "skip": {
        consola.debug(`Skipped ${action.path} (${action.reason})`);
        break;
      }
    }
  }

  // `previousId` exists to recover interrupted re-pins; once no local flow
  // pins the superseded revision, drop it — otherwise a developer who later
  // pins that old revision on purpose would get force-bumped by recovery.
  const remainingPins = new Set((await readLocalFlowUserSchemas(cwd)).values());
  const finalState = await readState(cwd);
  for (const [path, entry] of Object.entries(finalState.resources)) {
    if (entry.previousId && !remainingPins.has(entry.previousId)) {
      await updateState(cwd, path, { previousId: undefined });
    }
  }

  return { filesUpdated: [...new Set(filesUpdated)], applied };
}

/**
 * Rewrite a flow file's `user_schema` pin from `previousId` to `newId`,
 * lockfile-style. Prefers a targeted text replacement so the author's
 * formatting survives a one-string change; falls back to parse +
 * `stableStringify` when the raw text doesn't contain exactly one pin.
 * Returns false when the file doesn't pin `previousId` (already re-pinned
 * or hand-edited) — never throws for an unreadable file.
 */
async function repinFlowFile(
  cwd: string,
  relPath: string,
  previousId: string,
  newId: string,
): Promise<boolean> {
  const absPath = join(cwd, relPath);
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (err) {
    consola.debug(`read ${relPath} for re-pin failed:`, err);
    return false;
  }

  const pinPattern = new RegExp(
    `("user_schema"\\s*:\\s*)${escapeRegExp(JSON.stringify(previousId))}`,
    "g",
  );
  if (raw.match(pinPattern)?.length === 1) {
    await writeFile(
      absPath,
      raw.replace(pinPattern, (_match, prefix: string) => `${prefix}${JSON.stringify(newId)}`),
    );
    return true;
  }

  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    if (doc.user_schema !== previousId) {
      return false;
    }
    doc.user_schema = newId;
    await writeFile(absPath, `${stableStringify(doc)}\n`);
    return true;
  } catch (err) {
    consola.debug(`re-pin ${relPath} failed:`, err);
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reconcile a local file with the server's canonical body. What gets
 * written is the `normalizeWrite` form (strips pure transport noise like
 * the empty `audience` echo; for schemas the canonical body verbatim —
 * spelled-out x-* defaults must survive, or the next apply would publish
 * a revision without them). Equality is judged in the `normalize`
 * comparison form, so the file is rewritten only when it materially
 * differs from live state; hand-formatted files stay untouched otherwise.
 * Returns the state hash of the written form.
 */
export async function writeBackResource(
  cwd: string,
  relPath: string,
  syncer: Pick<ResourceSyncer, "normalize" | "normalizeWrite">,
  canonical: object,
): Promise<{ hash: string; changed: boolean }> {
  let writeBody = syncer.normalizeWrite?.(canonical) ?? canonical;
  const compare = (body: object) => stableStringify(syncer.normalize?.(body) ?? body);
  const absPath = join(cwd, relPath);
  let changed = true;
  try {
    const onDisk = JSON.parse(await readFile(absPath, "utf8")) as Record<string, unknown>;
    changed = compare(writeBody) !== compare(onDisk);
    // `$schema` is a local editor affordance (points at the dialect spec in
    // .zitadel/meta/); the server never echoes it, so a rewrite would drop
    // it. Carry the on-disk pointer over unless the canonical body has its
    // own (user-schema documents do).
    if (typeof onDisk.$schema === "string" && !("$schema" in writeBody)) {
      writeBody = { ...writeBody, $schema: onDisk.$schema };
    }
  } catch (err) {
    consola.debug(`read ${relPath} for write-back failed:`, err);
  }
  if (changed) {
    await writeFile(absPath, `${stableStringify(writeBody)}\n`);
  }
  return { hash: hashForState(syncer, writeBody), changed };
}

async function fetchOldIfAsked(
  syncer: ResourceSyncer,
  id: string,
  fetchOld: boolean,
): Promise<object | null> {
  if (!fetchOld || !syncer.fetch) {
    return null;
  }
  try {
    return await syncer.fetch(id);
  } catch (err) {
    consola.debug(`fetch ${syncer.kind} ${id} failed:`, err);
    return null;
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

/**
 * Walk `.zitadel/flows/*.json` once and return each flow's `user_schema` value
 * keyed by project-root-relative path. A flow file without a `user_schema` (or
 * with a non-string one) is skipped: it does not pin a schema revision, so it
 * cannot be affected by one.
 */
async function readLocalFlowUserSchemas(cwd: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const flows = await readJsonDir(join(cwd, FLOWS_DIR));
  for (const [absPath, content] of flows.entries()) {
    const relPath = absPath.slice(cwd.length + 1);
    if (
      typeof content === "object" &&
      content !== null &&
      "user_schema" in content &&
      typeof (content as { user_schema: unknown }).user_schema === "string"
    ) {
      result.set(relPath, (content as { user_schema: string }).user_schema);
    }
  }
  return result;
}

function findFlowsPinnedTo(
  previousId: string,
  localFlows: Map<string, string>,
): ReadonlyArray<string> {
  const affected: string[] = [];
  for (const [relPath, ref] of localFlows.entries()) {
    if (ref === previousId) {
      affected.push(relPath);
    }
  }
  return affected;
}

/**
 * Legacy content hash: order-sensitive and normalization-blind. Kept only
 * so state entries written by older CLI versions still match; new hashes
 * come from {@link hashForState}.
 */
export function hashResourceContent(data: object): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/**
 * The content hash stored in `.zitadel/state.json`: key-order-insensitive
 * (via `stableStringify`) and computed on the syncer's normalized form, so
 * reordering keys or spelling out a meta-schema default does not read as an
 * edit.
 */
export function hashForState(
  syncer: Pick<ResourceSyncer, "normalize">,
  data: object,
): string {
  const normalized = syncer.normalize?.(data) ?? data;
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}
