import { Args, Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { liveTargets, servingByOrigin, targetLabel } from "../../lib/deployments";
import { connectEnvironment } from "../../lib/environment";
import { ZitadelError } from "../../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";

/**
 * `zitadel deployment rollback` — undo a deployment. The unit is the
 * deployment, not the URL: every target it moved goes back together, as a
 * new deployment.
 */
export default class DeploymentRollback extends BaseCommand {
  static override description =
    "Undo the newest deployment, or go back to an earlier one by id.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 7;
  static override examples = [
    "<%= config.bin %> deployment rollback",
    "<%= config.bin %> deployment rollback dep_01KB3F8N2P9S5WQV",
    "<%= config.bin %> deployment rollback --origin https://app.acme.com",
  ];
  static override args = {
    deployment_id: Args.string({
      description: "Re-apply what this deployment set on every target it touched.",
    }),
  };
  static override flags = {
    origin: Flags.string({ description: "Narrow the rollback to one target ('default' for the project default)." }),
    message: Flags.string({ char: "m", description: "Summary recorded on the rollback." }),
    force: Flags.boolean({ char: "f", description: "Skip the confirmation. Required when non-interactive." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(DeploymentRollback);
    await this.toMeta(flags);
    const { cwd, env, dryRun, nonInteractive, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    const to = args.deployment_id;
    const origin = flags.origin === undefined ? undefined : flags.origin === "default" ? "" : flags.origin;
    const before = servingByOrigin(await liveTargets(client, projectId));

    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { deployment_id: to, origin } });
    }
    if (!flags.force) {
      if (nonInteractive) {
        throw new ZitadelError("E_VALIDATION", "rollback needs --force when non-interactive");
      }
      const answer = await confirm({
        message: to ? `Go back to ${to}?` : "Undo the newest deployment?",
      });
      if (isCancel(answer) || !answer) {
        cancel("Rollback cancelled.");
        throw new ZitadelError("E_VALIDATION", "Rollback cancelled by user");
      }
    }

    const result = await client.rollbackDeployment(
      {
        ...(to ? { deployment_id: to } : {}),
        ...(origin !== undefined ? { origin } : {}),
        ...(flags.message ? { message: flags.message } : {}),
      },
      { project_id: projectId },
    );
    const { deployment } = result;
    const warnings = result.warnings ?? [];
    const lines = deployment.targets.map(
      (target) =>
        `  ${targetLabel(target.origin).padEnd(42)} ${before.get(target.origin) ?? "(nothing)"} -> ${deployment.release_id}`,
    );
    return this.emit({
      status: "ok",
      data: {
        deployment_id: deployment.id,
        targets: deployment.targets.map((target) => target.origin),
        deployment,
        warnings,
      },
      warnings,
      pretty: [
        ...lines,
        ...warnings.map((warning) => `warning  ${warning}`),
        "",
        `rolled back  ${deployment.id}   ${deployment.targets.length} target${deployment.targets.length === 1 ? "" : "s"}`,
      ].join("\n"),
    });
  }
}
