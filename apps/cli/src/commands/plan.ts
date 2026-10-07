import { consola } from "consola";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { connectEnvironment } from "../lib/environment";
import {
  buildSyncPlan,
  collectPlanWarnings,
  enumeratePlanResources,
  makeSyncers,
  renderPlan,
  summarizePlan,
} from "../lib/sync";

/**
 * `zitadel plan` — validate config and preview the sync diff without mutating.
 *
 * The read-only counterpart of `apply`: it builds and renders the diff instead
 * of running the sync loop. All validation (structural shape and env-ref
 * presence) happens in the sync engine, so an invalid file fails the same way
 * `apply` would.
 */
export default class Plan extends BaseCommand {
  static override description = "Validate config without mutation and preview the sync diff.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 1;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Plan);
    await this.toMeta(flags);
    const { cwd, env, isTTY, serverFlag, envName, envFile } = this.meta;

    // Verbatim: the plan diffs what it reads against the project's files.
    const { client, projectId, server } = await connectEnvironment(
      { cwd, env, serverFlag, envName, envFile },
      { verbatim: true },
    );
    consola.info(`Project   ${projectId}`);
    consola.info(`Server    ${server}`);
    const syncers = makeSyncers({
      client,
      projectId,
      env,
      cwd,
    });

    consola.start("Building plan");
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
        `${summary.deletes} delete${summary.deletes === 1 ? "" : "s"}, ` +
        `${plan.length - summary.total} unchanged`,
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
