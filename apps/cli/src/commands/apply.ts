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
 * Options accepted by {@link runApply}. `environment` is validated by the flag
 * layer but not otherwise consumed here.
 */
export type ApplyOptions = GlobalOptions & {
  environment?: string;
};

/**
 * Validates the local flows against the remote project, then either previews
 * the sync diff (`dryRun` — backs `zitadel plan` and `apply --dry-run`) or runs
 * the sync loop to convergence (`zitadel apply`). The project secret and any
 * `${VAR}` / `*_env` references are checked up front so missing configuration
 * fails fast with `E_VALIDATION` before the platform is contacted.
 */
export async function runApply(opts: ApplyOptions): Promise<CommandResult> {
  const secret = await readZitadelSecret(opts.cwd);

  const flows = await readJsonDir(join(opts.cwd, FLOWS_DIR));
  validateFlows(flows);

  const missing = flowEnvRefs(flows).filter((name) => !opts.env[name]);
  if (missing.length > 0) {
    throw new ZitadelError("E_VALIDATION", `Missing environment variables: ${missing.join(", ")}`);
  }

  const client = createPlatformClient(opts.source, secret.project_secret);
  const syncers = makeSyncers({ projectId: secret.project_id });

  if (!opts.dryRun) {
    await runSyncLoop(opts.cwd, client, syncers);
    return { status: "ok", data: { synced: true } };
  }

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
