import { Flags } from "@oclif/core";
import { consola } from "consola";

import { planWithContext, resolveApplyContext } from "../lib/apply";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema } from "../lib/environment";
import {
  collectPlanWarnings,
  enumeratePlanResources,
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
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
      options: [...environmentSchema.options],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Plan);
    await this.toMeta(flags);
    const { cwd, source, env, isTTY } = this.meta;

    const context = await resolveApplyContext({ cwd, source, env });
    consola.info(`Project   ${context.projectId}`);
    consola.info(`Server    ${source}`);

    consola.start("Building plan");
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
