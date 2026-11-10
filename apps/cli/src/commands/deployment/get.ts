import { DeploymentService } from "@/lib/backend";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "@/lib/oclif";
import { Tabulatable } from "@/lib/oclif/tabulatable";
import { variableCell } from "@/lib/variables";
import { painted } from "@/lib/oclif/rendering";

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
    // The frozen variables are only shown, so `--json`, which prints no
    // rendering, neither reads them nor needs the permission that read takes.
    const [deployment, variables] = await Promise.all([
      deploymentService.get(args.deploymentId),
      this.isJson ? undefined : deploymentService.variables(args.deploymentId),
    ]);

    return this.emit({
      status: "ok",
      data: deployment,
      // Painted, because the variables below are a table the CLI coloured.
      // The summary is a detail view rather than lines of its own, so every
      // field of it is spelled out where the cells are, not by hand here.
      pretty: painted(
        [
          this.tabulateDetail(deployment.id, ["release_id", "reason", "deployed_at", "origins"], {
            release_id: deployment.release_id,
            reason: deployment.reason,
            deployed_at: deployment.deployed_at,
            origins: deployment.origins.join(", "),
          }),
          "",
          variables === undefined || variables.length === 0
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
      ),
    });
  }
}
