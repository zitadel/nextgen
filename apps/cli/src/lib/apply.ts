import { createZitadelClient } from "./api-client";
import { readZitadelSecret } from "./project";
import {
  buildSyncPlan,
  makeSyncers,
  runSyncLoop,
  type ResourceSyncer,
  type SyncAction,
  type SyncLoopResult,
} from "./sync";

/**
 * What the sync engine needs to know before it can touch the platform: the
 * project directory, the server to talk to, and the runtime environment the
 * `${VAR}` / `*_env` references in the config files resolve against.
 */
export type ApplyInput = {
  cwd: string;
  source: string;
  env: Record<string, string | undefined>;
};

/** A resolved project and the syncers bound to it, ready to plan or apply. */
export type ApplyContext = {
  cwd: string;
  projectId: string;
  syncers: ReadonlyArray<ResourceSyncer>;
};

/**
 * Reads `.zitadel/secret` and builds the syncers for the project it names.
 *
 * Shared by `zitadel apply`, `zitadel plan`, and the `zitadel run` dev loop
 * (its `r` key), so the three cannot drift: an apply from inside the running
 * session does exactly what the standalone command does. Resolved separately
 * from the run itself so a caller can name the project before the sync starts
 * narrating.
 */
export async function resolveApplyContext(input: ApplyInput): Promise<ApplyContext> {
  const secret = await readZitadelSecret(input.cwd);
  // Verbatim: the sync loop diffs and writes back what it reads.
  const client = createZitadelClient(
    { baseUrl: input.source, token: secret.project_secret },
    { verbatim: true },
  );
  return {
    cwd: input.cwd,
    projectId: secret.project_id,
    syncers: makeSyncers({
      client,
      projectId: secret.project_id,
      env: input.env,
      cwd: input.cwd,
    }),
  };
}

/**
 * Runs the sync loop to convergence: validates the repo config, uploads it,
 * and writes the platform's canonical bodies back to disk. All validation
 * (structural shape and reference presence) happens inside
 * {@link buildSyncPlan}, so invalid config fails with `E_VALIDATION` before
 * any platform call.
 */
export async function applyWithContext(context: ApplyContext): Promise<SyncLoopResult> {
  return runSyncLoop(context.cwd, context.syncers);
}

/** The same validation and diff as {@link applyWithContext}, mutating nothing. */
export async function planWithContext(
  context: ApplyContext,
): Promise<ReadonlyArray<SyncAction>> {
  return buildSyncPlan(context.cwd, context.syncers, true);
}
