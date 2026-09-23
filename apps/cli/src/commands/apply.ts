import { Flags } from "@oclif/core";
import { consola } from "consola";

import { applyWithContext, planWithContext, resolveApplyContext } from "../lib/apply";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema } from "../lib/environment";
import {
  collectPlanWarnings,
  enumeratePlanResources,
  renderPlan,
  summarizePlan,
} from "../lib/sync";
import { publicCliCommand } from "../lib/public-cli";

/**
 * `zitadel apply` — validate and upload repo config to the platform.
 *
 * Runs the sync loop to convergence, or (with `--dry-run`) previews the diff
 * without mutating. All validation — structural shape and `${VAR}` / `*_env`
 * reference presence — happens inside the sync engine (`buildSyncPlan`),
 * so an invalid or under-configured file fails with `E_VALIDATION` before any
 * platform call.
 */
export default class Apply extends BaseCommand {
  static override description = "Validate and upload repo config to the platform.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 2;
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

    const context = await resolveApplyContext({ cwd, source, env });
    consola.info(`Project   ${context.projectId}`);
    consola.info(`Server    ${source}`);

    if (!dryRun) {
      consola.start("Syncing schemas and flows to Zitadel");
      const { filesUpdated, applied } = await applyWithContext(context);
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
    const plan = await planWithContext(context);
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
