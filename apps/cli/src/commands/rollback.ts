import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { liveDeployments, servingByOrigin, targetLabel } from "../lib/deployments";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { connectTarget } from "../lib/target";

/**
 * `zitadel rollback` — undo a deploy. The unit is the deploy, not the URL:
 * every target the deploy moved goes back together, under a new deploy id.
 */
export default class Rollback extends BaseCommand {
  static override description = "Undo the newest deploy, or go back to an earlier one with --to.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 7;
  static override examples = [
    "<%= config.bin %> rollback",
    "<%= config.bin %> rollback --to dpl_01KB3F8N2P9S5WQV",
    "<%= config.bin %> rollback --origin https://app.acme.com",
  ];
  static override flags = {
    to: Flags.string({ description: "Re-apply what this deploy set on every target it touched." }),
    origin: Flags.string({ description: "Narrow the rollback to one target ('default' for the project default)." }),
    message: Flags.string({ char: "m", description: "Summary recorded on the rollback." }),
    force: Flags.boolean({ char: "f", description: "Skip the confirmation. Required when non-interactive." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Rollback);
    await this.toMeta(flags);
    const { cwd, env, dryRun, nonInteractive, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    const origin = flags.origin === undefined ? undefined : flags.origin === "default" ? "" : flags.origin;
    const before = servingByOrigin(await liveDeployments(client, projectId));

    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { to: flags.to, origin } });
    }
    if (!flags.force) {
      if (nonInteractive) {
        throw new ZitadelError("E_VALIDATION", "rollback needs --force when non-interactive");
      }
      const answer = await confirm({
        message: flags.to ? `Go back to ${flags.to}?` : "Undo the newest deploy?",
      });
      if (isCancel(answer) || !answer) {
        cancel("Rollback cancelled.");
        throw new ZitadelError("E_VALIDATION", "Rollback cancelled by user");
      }
    }

    const result = await client.rollbackDeployment(
      {
        ...(flags.to ? { deploy_id: flags.to } : {}),
        ...(origin !== undefined ? { origin } : {}),
        ...(flags.message ? { message: flags.message } : {}),
      },
      { project_id: projectId },
    );
    const lines = result.deployments.map(
      (row) => `  ${targetLabel(row.origin).padEnd(42)} ${before.get(row.origin) ?? "(nothing)"} -> ${row.release_id}`,
    );
    return this.emit({
      status: "ok",
      data: {
        deploy_id: result.deploy_id,
        targets: result.targets,
        deployments: result.deployments,
        warnings: result.warnings ?? [],
      },
      warnings: result.warnings ?? [],
      pretty: [
        ...lines,
        ...(result.warnings ?? []).map((warning) => `warning  ${warning}`),
        "",
        `rolled back  ${result.deploy_id}   ${result.deployments.length} deployment records written`,
      ].join("\n"),
    });
  }
}
