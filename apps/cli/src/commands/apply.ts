import { consola } from "consola";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { reportWarning } from "../lib/warnings";
import {
  buildSyncPlan,
  collectPlanWarnings,
  enumeratePlanResources,
  makeSyncers,
  renderPlan,
  runSyncLoop,
  summarizePlan,
} from "../lib/sync";
import { nextCommandsData } from "../lib/oclif/envelope";

/**
 * `zitadel apply` — validate and upload repo config to the platform.
 *
 * Runs the sync loop to convergence, or (with `--dry-run`) previews the diff
 * without mutating. All validation — structural shape and `${VAR}` / `*_env`
 * reference presence — happens inside the sync engine ({@link buildSyncPlan}),
 * so an invalid or under-configured file fails with `E_VALIDATION` before any
 * platform call.
 */
export default class Apply extends EnvironmentCommand {
  static override description = "Validate and upload repo config to the platform.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 2;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Apply);
    await this.toMeta(flags);
    const { cwd, env, dryRun, isTTY } = this.meta;

    // Verbatim: the sync loop diffs and writes back what it reads.
    const { client, projectId } = await this.connect({ verbatim: true });
    const syncers = makeSyncers({
      client,
      projectId,
      env,
      cwd,
    });

    if (!dryRun) {
      consola.start("Syncing schemas and flows to Zitadel");
      const { filesUpdated, applied, unsupported } = await runSyncLoop(cwd, syncers);
      if (applied.length === 0 && unsupported.length > 0) {
        reportWarning(
          `Nothing was applied: ${unsupported.length} removed file${unsupported.length === 1 ? "" : "s"} cannot be deleted from the platform yet.`,
        );
      } else {
        consola.success("Sync complete");
      }
      return this.emit({
        status: "ok",
        data: {
          synced: true,
          // Platform resources this run touched (with resulting ids);
          // `files_updated` lists the local rewrites only: re-pinned flows.
          changes: applied,
          files_updated: filesUpdated,
          unsupported_deletions: unsupported.length,
          unsupported_deletion_files: unsupported,
          next_actions:
            applied.length === 0
              ? [
                  unsupported.length > 0
                    ? `${unsupported.length} removed file${unsupported.length === 1 ? " was" : "s were"} not deleted from the platform: deleting is not supported yet (#1013). Restore ${unsupported.length === 1 ? "it" : "them"} if that was a mistake.`
                    : "Everything is already in sync — no changes were applied.",
                ]
              : [
                  "Changes are live — reload your app to see them.",
                  "Re-run plan to confirm local config and platform are in sync.",
                ],
          // Carry the selector in effect so the suggested re-run targets the
          // same environment this apply did, not the default one.
          ...nextCommandsData([this.suggest("plan")]),
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
        `${summary.moves} moved, ` +
        `${summary.deletes} delete${summary.deletes === 1 ? "" : "s"}` +
        (summary.unsupported_deletions > 0
          ? `, ${summary.unsupported_deletions} removed but kept (cannot be deleted yet)`
          : ""),
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
