import { Flags } from "@oclif/core";

import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { setApiAuthToken } from "@zitadel-nextgen/api/runtime/auth";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { environmentSchema } from "../lib/environment";
import { buildSyncPlan, makeSyncers, renderPlan, summarizePlan } from "../lib/sync";
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
  // Temporarily hidden while we collapse the dev workflow around `setup`'s
  // auto-apply. The logic stays wired up so re-exposing this command is a
  // one-line flip when we settle on the surface area.
  static override hidden = true;
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
    setApiBaseUrl(source.replace(/\/+$/, ""));
    setApiAuthToken(secret.project_secret);
    const syncers = makeSyncers({ projectId: secret.project_id, env });

    const plan = await buildSyncPlan(cwd, syncers, true);
    return this.emit({
      status: "ok",
      data: summarizePlan(plan),
      pretty: renderPlan(plan, isTTY),
    });
  }
}
