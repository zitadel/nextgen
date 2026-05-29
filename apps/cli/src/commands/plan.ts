import { join } from "node:path";

import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { FLOWS_DIR, flowEnvRefs } from "../lib/flows";
import { readJsonDir } from "../lib/json-dir";
import { createPlatformClient } from "../lib/api";
import { environmentSchema } from "../lib/api/schemas";
import { buildSyncPlan, makeSyncers, renderPlan } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";

/**
 * `zitadel plan` — validate config and preview the sync diff without mutating.
 *
 * The read-only counterpart of `apply`: same preflight (env-ref check; the sync
 * engine structurally validates every schema and flow), but it builds and
 * renders the diff instead of running the sync loop.
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
    const flows = await readJsonDir(join(cwd, FLOWS_DIR));
    const missing = flowEnvRefs(flows).filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new ZitadelError("E_VALIDATION", `Missing environment variables: ${missing.join(", ")}`);
    }

    const client = createPlatformClient(source, secret.project_secret);
    const syncers = makeSyncers({ projectId: secret.project_id });

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
