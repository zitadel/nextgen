import { DeploymentService } from "../../lib/backend";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "../../lib/oclif";
import { Tabulatable } from "../../lib/oclif/tabulatable";
import { variableCell } from "../../lib/variables";

/**
 * `zitadel deployment get <deployment_id>` — read one deployment record: the
 * release it made live, the origins it went to, when, and the variables it
 * froze.
 */
export default class DeploymentGet extends Tabulatable(EnvironmentCommand) {
  static override description = "Read one deployment by id.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> deployment get dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"];
  static override args = {
    deployment_id: nonBlankArg({ required: true, description: "The deployment to read." }),
  };

  protected async execute({ args }: Admitted<typeof DeploymentGet>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const deploymentService = new DeploymentService(client, projectId);
    const { deployment, variables } = await deploymentService.get(args.deploymentId);

    const origins = deployment.origins;

    return this.emit({
      status: "ok",
      data: deployment,
      pretty: [
        `${deployment.id}`,
        `  release   ${deployment.release_id}`,
        `  reason    ${deployment.metadata.reason ?? "deploy"}`,
        `  deployed  ${deployment.deployed_at}`,
        `  origins   ${origins.join(", ")}`,
        "",
        variables.length === 0
          ? "  variables  none"
          : [
              "  variables",
              ...(
                await this.tabulate(
                  ["name", "value"],
                  variables.map((variable) => {
                    return variableCell(variable);
                  }),
                )
              )
                .split("\n")
                .map((line) => {
                  return `    ${line}`;
                }),
            ].join("\n"),
      ].join("\n"),
    });
  }
}
