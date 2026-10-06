import type { CreateReleaseBodyPointersItem } from "@zitadel/api/generated/model";
import { consola } from "consola";

import type { ZitadelClient } from "./api-client";
import { BRANDING_DIR } from "./branding";
import { FLOWS_DIR } from "./flows";
import { makeSyncers, runSyncLoop } from "./sync";
import { readState } from "./sync/state";
import { SCHEMAS_DIR } from "./user-schema";

export type BuiltRelease = Readonly<{
  id: string;
  /** The SHA-256 over the pinned set, which a build pins with `sha256:<hash>`. */
  content_hash: string;
  /** False when the server already held a release of this content. */
  created: boolean;
  pointers: readonly CreateReleaseBodyPointersItem[];
  /** The resources the sync loop uploaded or revised on the way. */
  changed: number;
}>;

/** The release pointer kind a `.zitadel/` directory's files are pinned under. */
const KIND_BY_DIR: ReadonlyArray<[string, CreateReleaseBodyPointersItem["kind"]]> = [
  [SCHEMAS_DIR, "schema"],
  [FLOWS_DIR, "flow_definition"],
  [BRANDING_DIR, "branding"],
];

/**
 * Builds a release from `.zitadel/`: the sync loop puts every resource on the
 * server (reusing what is unchanged), then the revision ids it recorded in
 * `.zitadel/state.json` become the release's pointers. Identical content
 * resolves to the release that already holds it.
 */
export async function buildRelease(opts: {
  cwd: string;
  client: ZitadelClient;
  projectId: string;
  env: NodeJS.ProcessEnv;
  message?: string;
}): Promise<BuiltRelease> {
  const syncers = makeSyncers({
    client: opts.client,
    projectId: opts.projectId,
    env: opts.env,
    cwd: opts.cwd,
  });
  const { applied } = await runSyncLoop(opts.cwd, syncers);
  const pointers = await pointersFromState(opts.cwd);
  if (pointers.length === 0) {
    throw new Error("nothing to release: .zitadel/ holds no synced resource");
  }
  const release = await opts.client.createRelease(
    { pointers, ...(opts.message ? { message: opts.message } : {}) },
    { project_id: opts.projectId },
  );
  // The client cannot see the status code; a release the server already held
  // echoes an id the state file did not just mint, which is the only thing a
  // caller uses `created` for.
  const created = applied.length > 0;
  consola.success(`Release ${release.id}${created ? "" : " (exists, reusing)"}`);
  return { id: release.id, content_hash: release.content_hash, created, pointers, changed: applied.length };
}

async function pointersFromState(cwd: string): Promise<CreateReleaseBodyPointersItem[]> {
  const state = await readState(cwd);
  const pointers: CreateReleaseBodyPointersItem[] = [];
  for (const [path, entry] of Object.entries(state.resources)) {
    if (!entry.id) {
      continue;
    }
    const kind = KIND_BY_DIR.find(([dir]) => path.startsWith(`${dir}/`))?.[1];
    if (kind) {
      pointers.push({ kind, revision_id: entry.id });
    }
  }
  return pointers;
}
