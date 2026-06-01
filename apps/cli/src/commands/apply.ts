import { Flags } from "@oclif/core";

import { createZitadelClient } from "@zitadel-nextgen/api/client";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema, type ZitadelEnvironment } from "../lib/environment";
import { buildSyncPlan, makeSyncers, renderPlan, runSyncLoop, summarizePlan } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";
import { ensureClaimedForEnvironment } from "./claim-gate";

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
    const environment = parseEnvironment(flags.environment);

    const secret = await readZitadelSecret(cwd);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });

    await ensureClaimedForEnvironment(client, secret.project_id, environment);

    const syncers = makeSyncers({ client, projectId: secret.project_id, env });

    if (!dryRun) {
      await runSyncLoop(cwd, syncers);
      const apply = await client.applyProjectConfig(secret.project_id, { environment }, { source: "cli" });
      return this.emit({ status: "ok", data: { synced: true, apply } });
    }

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
