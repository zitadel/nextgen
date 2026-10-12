import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { rollbackDeployment } from "../../lib/release";
import { ZitadelError } from "../../lib/errors";
import { publicCliCommand } from "../../lib/public-cli";

/**
 * `zitadel deployment rollback [<deployment_id>]` — re-apply an earlier
 * deployment.
 *
 * Bare, it undoes the last deploy: it re-applies the deployment that was live
 * before the current one. Given a `<deployment_id>`, it re-applies exactly that
 * one. `--origin` narrows which origin's history it reads for the bare form. A
 * rollback re-serves an earlier release, so it takes the `--force`-or-confirm
 * gate the destructive commands use.
 */
export default class DeploymentRollback extends EnvironmentCommand {
  static override description = "Roll back to an earlier deployment.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment rollback",
    "<%= config.bin %> deployment rollback dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
    "<%= config.bin %> deployment rollback --origin https://app.acme.com --force",
  ];
  static override args = {
    deployment_id: nonBlankArg({
      required: false,
      description: "The deployment to re-apply. Omit to undo the last deploy.",
    }),
  };
  static override flags = {
    origin: Flags.string({ description: "Which origin's history the bare form reads." }),
    force: Flags.boolean({
      char: "f",
      description: "Roll back without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(DeploymentRollback);
    await this.toMeta(flags);
    const { nonInteractive, force, cliVersion } = this.meta;

    const { client, projectId } = await this.connect();

    // Bare: re-apply the deployment that ran before the current one. With an
    // id, re-apply exactly that one.
    let targetId = args.deployment_id as string | undefined;
    if (targetId === undefined) {
      const { deployments } = await client.listDeployments({
        project_id: projectId,
        ...(flags.origin === undefined ? {} : { origin: flags.origin }),
      });
      const previous = deployments[1];
      if (!previous) {
        throw new ZitadelError("E_VALIDATION", "There is no earlier deployment to roll back to", {
          hint: "Name a deployment to re-apply, or check `zitadel deployment list`.",
        });
      }
      targetId = previous.id;
    }

    if (!force) {
      if (nonInteractive) {
        throw new ZitadelError(
          "E_VALIDATION",
          "Rolling back requires --force in non-interactive mode",
          {
            hint: `Pass --force to re-apply ${targetId}.`,
            nextCommands: [publicCliCommand(`deployment rollback ${targetId} --force`, cliVersion)],
          },
        );
      }
      const answer = await confirm({
        message: `Re-apply ${targetId}? Its release goes live again.`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Rollback cancelled.");
        return this.emit({ status: "skipped", reason: "rollback-cancelled" });
      }
    }

    const deployment = await rollbackDeployment(client, projectId, targetId);

    const origins = deployment.targets.map((target) => target.origin);
    return this.emit({
      status: "ok",
      data: {
        deployment_id: deployment.id,
        release_id: deployment.release_id,
        rolled_back_to: deployment.metadata.rollback_to,
        origins,
      },
      pretty: `Rolled back to ${deployment.release_id} on ${origins.join(", ")}`,
    });
  }
}
