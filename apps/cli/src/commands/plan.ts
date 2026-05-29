import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { createPlatformClient } from "../lib/api";
import { environmentSchema } from "../lib/api/schemas";
import { buildSyncPlan, makeSyncers, renderPlan } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";

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

    const secret = await readZitadelSecret(cwd);
    const client = createPlatformClient(source, secret.project_secret);
    const syncers = makeSyncers({ projectId: secret.project_id, env });

    const plan = await buildSyncPlan(cwd, syncers, client);
    const active = plan.filter((action) => action.kind !== "skip");
    return this.emit({
      status: "ok",
      data: {
        creates: active.filter((action) => action.kind === "create").length,
        updates: active.filter((action) => action.kind === "update").length,
        deletes: active.filter((action) => action.kind === "delete").length,
        total: active.length,
      },
      pretty: renderPlan(plan, isTTY),
    });
  }
}
