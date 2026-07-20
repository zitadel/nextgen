import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema } from "../lib/environment";
import {
  buildSyncPlan,
  collectPlanWarnings,
  enumeratePlanResources,
  makeSyncers,
  renderPlan,
  runSyncLoop,
  summarizePlan,
} from "../lib/sync";
import { readZitadelSecret } from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";

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
    const syncers = makeSyncers({
      client,
      projectId: secret.project_id,
      env,
      cwd,
    });

    if (!dryRun) {
      consola.start("Syncing schemas and flows to Zitadel");
      const { filesUpdated, applied } = await runSyncLoop(cwd, syncers);
      consola.success("Sync complete");
      return this.emit({
        status: "ok",
        data: {
          synced: true,
          // Platform resources this run touched (with resulting ids);
          // `files_updated` stays the local write-backs only.
          changes: applied,
          files_updated: filesUpdated,
          next_actions:
            applied.length === 0
              ? ["Everything is already in sync — no changes were applied."]
              : [
                  "Changes are live — reload your app to see them.",
                  "Re-run plan to confirm local config and platform are in sync.",
                ],
          next_commands: [publicCliCommand("plan", this.meta.cliVersion)],
        },
      });
    }

    consola.start("Building plan (dry run)");
    const plan = await buildSyncPlan(cwd, syncers, true);
    const summary = summarizePlan(plan);
    this.recordTelemetry({
      creates: summary.creates,
      updates: summary.updates,
      revisions: summary.revisions,
      deletes: summary.deletes,
      total: summary.total,
    });
    consola.success(
      `Plan: ${summary.creates} create${summary.creates === 1 ? "" : "s"}, ` +
        `${summary.updates} update${summary.updates === 1 ? "" : "s"}, ` +
        `${summary.revisions} new revision${summary.revisions === 1 ? "" : "s"}, ` +
        `${summary.deletes} delete${summary.deletes === 1 ? "" : "s"}`,
    );
    return this.emit({
      status: "ok",
      data: {
        ...summary,
        changes: enumeratePlanResources(plan),
        warnings: collectPlanWarnings(plan),
      },
      pretty: renderPlan(plan, isTTY),
    });
  }
}
