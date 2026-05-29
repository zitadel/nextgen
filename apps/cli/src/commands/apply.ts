import { join } from "node:path";

import { Flags } from "@oclif/core";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { FLOWS_DIR, flowEnvRefs } from "../lib/flows";
import { readJsonDir } from "../lib/json-dir";
import { createPlatformClient } from "../lib/api";
import { environmentSchema } from "../lib/api/schemas";
import { buildSyncPlan, makeSyncers, renderPlan, runSyncLoop } from "../lib/sync";
import { readZitadelSecret } from "../lib/project";

/**
 * `zitadel apply` — validate and upload repo config to the platform.
 *
 * Runs the sync loop to convergence, or (with `--dry-run`) previews the diff
 * without mutating. The only preflight here is the `${VAR}` / `*_env` reference
 * check, which needs the runtime environment; structural validation of every
 * schema and flow happens inside the sync engine ({@link buildSyncPlan}), so an
 * invalid file fails with `E_VALIDATION` before any platform call.
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
    const flows = await readJsonDir(join(cwd, FLOWS_DIR));
    const missing = flowEnvRefs(flows).filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new ZitadelError("E_VALIDATION", `Missing environment variables: ${missing.join(", ")}`);
    }

    const client = createPlatformClient(source, secret.project_secret);
    const syncers = makeSyncers({ projectId: secret.project_id });

    if (!dryRun) {
      await runSyncLoop(cwd, client, syncers);
      return this.emit({ status: "ok", data: { synced: true } });
    }

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
