import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema } from "../lib/environment";
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
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    const syncers = makeSyncers({ client, projectId: secret.project_id, env });

    if (!dryRun) {
      consola.start("Syncing schemas and flows to Zitadel");
      await runSyncLoop(cwd, syncers);
      consola.success("Sync complete");
      return this.emit({ status: "ok", data: { synced: true } });
    }

    consola.start("Building plan (dry run)");
    const plan = await buildSyncPlan(cwd, syncers, true);
    const summary = summarizePlan(plan);
    consola.success(
      `Plan: ${summary.creates} create${summary.creates === 1 ? "" : "s"}, ` +
        `${summary.updates} update${summary.updates === 1 ? "" : "s"}, ` +
        `${summary.deletes} delete${summary.deletes === 1 ? "" : "s"}`,
    );
    return this.emit({
      status: "ok",
      data: summary,
      pretty: renderPlan(plan, isTTY),
    });
  }
}
