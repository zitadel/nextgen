import { join } from "node:path";

import { Flags } from "@oclif/core";

import { BaseCommand, type CommandResult, type GlobalOptions, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { FLOWS_DIR, flowEnvRefs, validateFlows } from "../lib/flows";
import { readJsonDir } from "../lib/json-dir";
import { createPlatformClient } from "../lib/api";
import { environmentSchema } from "../lib/api/schemas";
import { buildSyncPlan, makeSyncers, renderPlan, runSyncLoop } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";

/**
 * Options accepted by {@link runApply} / {@link runPlan}. `environment` is
 * validated by the flag layer but not otherwise consumed here.
 */
export type ApplyOptions = GlobalOptions & {
  environment?: string;
};

/**
 * Shared preflight for `plan` and `apply`: load the project secret, read and
 * validate the local flows, fail fast (`E_VALIDATION`) on any missing `${VAR}`
 * / `*_env` reference, and build the platform client + syncers. Both verbs run
 * this identically; they only differ in what they do with the result.
 */
async function prepare(opts: ApplyOptions) {
  const secret = await readZitadelSecret(opts.cwd);

  const flows = await readJsonDir(join(opts.cwd, FLOWS_DIR));
  validateFlows(flows);

  const missing = flowEnvRefs(flows).filter((name) => !opts.env[name]);
  if (missing.length > 0) {
    throw new ZitadelError("E_VALIDATION", `Missing environment variables: ${missing.join(", ")}`);
  }

  const client = createPlatformClient(opts.source, secret.project_secret);
  const syncers = makeSyncers({ projectId: secret.project_id });
  return { client, syncers };
}

/**
 * Proposes the change set without mutating the platform: builds the sync plan
 * and returns its counts plus a rendered diff. Backs `zitadel plan` (and
 * `apply --dry-run`).
 */
export async function runPlan(opts: ApplyOptions): Promise<CommandResult> {
  const { client, syncers } = await prepare(opts);
  const plan = await buildSyncPlan(opts.cwd, syncers, client);
  const active = plan.filter((action) => action.kind !== "skip");
  return {
    status: "ok",
    data: {
      creates: active.filter((action) => action.kind === "create").length,
      updates: active.filter((action) => action.kind === "update").length,
      deletes: active.filter((action) => action.kind === "delete").length,
      total: active.length,
    },
    pretty: renderPlan(plan, opts.isTTY),
  };
}

/**
 * Applies the local `.zitadel/flows` definitions to the remote project, running
 * the sync loop to convergence. In dry-run it defers to {@link runPlan} — same
 * preflight, just propose instead of execute.
 */
export async function runApply(opts: ApplyOptions): Promise<CommandResult> {
  if (opts.dryRun) {
    return runPlan(opts);
  }
  const { client, syncers } = await prepare(opts);
  await runSyncLoop(opts.cwd, client, syncers);
  return { status: "ok", data: { synced: true } };
}

/** `zitadel apply` — validate and upload repo config to the platform. */
export default class Apply extends BaseCommand {
  static override description = "Validate and upload repo config to the platform.";
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
      options: [...environmentSchema.options],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Apply);
    await this.toMeta(flags);
    return this.emit(await runApply({ ...this.meta, environment: flags.environment }));
  }
}
