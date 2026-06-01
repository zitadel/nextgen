import { Flags } from "@oclif/core";

import { createZitadelClient } from "@zitadel-nextgen/api/client";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema, type ZitadelEnvironment } from "../lib/environment";
import { buildSyncPlan, makeSyncers, renderPlan, summarizePlan } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";
import { ensureClaimedForEnvironment } from "./claim-gate";

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
    const environment = parseEnvironment(flags.environment);

    const secret = await readZitadelSecret(cwd);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    await ensureClaimedForEnvironment(client, secret.project_id, environment);
    const syncers = makeSyncers({ client, projectId: secret.project_id, env });

    const plan = await buildSyncPlan(cwd, syncers, true);
    return this.emit({
      status: "ok",
      data: summarizePlan(plan),
      pretty: renderPlan(plan, isTTY),
    });
  }
}

function parseEnvironment(value: string | undefined): ZitadelEnvironment {
  return environmentSchema.parse(value ?? "development");
}
