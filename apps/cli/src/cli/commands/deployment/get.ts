import { Args } from "@oclif/core";
import { z } from "zod";

import { DeploymentService } from "@/lib/backend";
import { GetDeploymentParams, GetDeploymentResponse } from "@/lib/backend/schemas";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { type Refused, taken } from "@/cli/core/flags";
import { fieldPaths } from "@/cli/core/crud";
import { fieldsFlag } from "@/cli/core/tabulatable";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { VariableView } from "@/lib/variable";
import { ReadCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * The deployment `deployment get` reads. The schema is the API spec's own, so a value that is not one is
 * refused before anything is asked or called, and says what one looks like.
 */
const DEPLOYMENT_ID: Refused<string> = {
  schema: z.string().trim().pipe(GetDeploymentParams.shape.deployment_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "List the deployments to find one.",
    next: [{ id: "deployment:list" }],
    details: {
      argument: "{input}",
    },
  },
};

/**
 * `zitadel deployment get <deployment_id>` — read one deployment record: the
 * release it made live, the origins it went to, when, and the variables it
 * froze. `--fields` cuts the data and the rows to the dot-paths it names,
 * judged by the deployment's shape, and leaves the frozen variables out.
 */
export default class DeploymentGet extends Telemetered(ReadCommand) {
  static override description = "Read one deployment by id.";
  static override group = CommandGroups.releases;
  static override groupOrder = 5;

  static override examples = ["<%= config.bin %> deployment get dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"];
  static override args = {
    deployment_id: Args.custom<string>({
      parse: taken(DEPLOYMENT_ID),
    })({
      required: true,
      description: "The deployment to read.",
    }),
  };

  static override flags = {
    fields: fieldsFlag({
      shape: fieldPaths(GetDeploymentResponse),
    }),
  };

  /**
   * Reads one deployment by id.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The deployment.
   */
  protected async execute({ args, flags }: Admitted<typeof DeploymentGet>): Promise<CommandResult> {
    const deploymentService = await this.service(DeploymentService);
    const [deployment, variables] = await Promise.all([
      deploymentService.get(args.deploymentId),
      flags.fields === undefined
        ? this.forHumans(() => {
            return deploymentService.variables(args.deploymentId);
          })
        : undefined,
    ]);

    const held = variables ?? [];
    const listed =
      held.length === 0
        ? ["variables  none"]
        : [
            "variables",
            ...(
              await this.tabulate(
                ["name", "value"],
                held.map((variable) => {
                  return VariableView.of(variable).cell();
                }),
              )
            )
              .split("\n")
              .map((line) => {
                return `  ${line}`;
              }),
          ];
    const frozen = variables === undefined ? undefined : listed;
    const title = `Read ${escapeControlCharacters(deployment.id)}`;
    const view = this.viewRecord(deployment, flags.fields, [
      "id",
      "release_id",
      "reason",
      "origins",
      "deployed_at",
    ]);
    return {
      status: "ok",
      data: view.data,
      summary: {
        title,
        sections: [],
        lines: [
          ...this.tabulateDetail(
            undefined,
            view.columns,
            flags.fields === undefined
              ? {
                  id: deployment.id,
                  release_id: deployment.release_id,
                  reason: deployment.reason ?? "deploy",
                  origins: deployment.origins.join(", "),
                  deployed_at: deployment.deployed_at,
                }
              : view.data,
          ).split("\n"),
          ...(frozen === undefined ? [] : ["", ...frozen]),
        ],
      },
    };
  }
}
