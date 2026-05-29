import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { createPlatformClient } from "../lib/api";
import { environmentSchema } from "../lib/api/schemas";
import { buildSyncPlan, makeSyncers, renderPlan, runSyncLoop, summarizePlan } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";

/**
 * `zitadel apply` — validate and upload repo config to the platform.
 *
 * Runs the sync loop to convergence, or (with `--dry-run`) previews the diff
 * without mutating. All validation — structural shape and `${VAR}` / `*_env`
 * reference presence — happens inside the sync engine ({@link buildSyncPlan}),
 * so an invalid or under-configured file fails with `E_VALIDATION` before any
 * platform call.
 */
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
    const { cwd, source, env, dryRun, isTTY } = this.meta;

    const secret = await readZitadelSecret(cwd);
    const client = createPlatformClient(source, secret.project_secret);
    const syncers = makeSyncers({ projectId: secret.project_id, env });

    if (!dryRun) {
      await runSyncLoop(cwd, client, syncers);
      return this.emit({ status: "ok", data: { synced: true } });
    }

    const plan = await buildSyncPlan(cwd, syncers, client);
    return this.emit({
      status: "ok",
      data: summarizePlan(plan),
      pretty: renderPlan(plan, isTTY),
    });
  }
}
