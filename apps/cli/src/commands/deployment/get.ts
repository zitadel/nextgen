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
import { json, painted } from "@/lib/oclif/rendering";
import { DEPLOYMENT_FIELDS, deploymentRow } from "./list";

/**
 * `zitadel deployment get <deployment_id>` — read one deployment record: the
 * release it made live, the origins it went to, when, and the variables it
 * froze.
 */
export default class DeploymentGet extends Tabulatable(EnvironmentCommand) {
  static override description = "Read one deployment by id.";
  static override group = CommandGroups.configuration;

  static override heading = "Reading a deployment";
  static override examples = ["<%= config.bin %> deployment get dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"];
  static override args = {
    deployment_id: nonBlankArg({ required: true, description: "The deployment to read." }),
  };

  protected async execute({ args }: Admitted<typeof DeploymentGet>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const deploymentService = new DeploymentService(client, projectId);
    // Only the terminal rendering names the frozen set, so only it reads one:
    // `--json` carries the record alone and prints no rendering, and a pipe
    // gets the record too, because a script wants the record rather than a
    // view of it.
    const shows = !this.isJson && this.isOnScreen;
    const [deployment, variables] = await Promise.all([
      deploymentService.get(args.deploymentId),
      shows ? deploymentService.variables(args.deploymentId) : undefined,
    ]);

    // One record reads the same here as it does from any other `get`: the
    // identifier, then a labelled line per field, at the left margin and
    // named as the wire names them, with the set the deployment froze tabled
    // under them.
    const frozen =
      variables === undefined
        ? undefined
        : variables.length === 0
          ? "variables  none"
          : [
              "variables",
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
                  return `  ${line}`;
                }),
            ].join("\n");
    return this.emit({
      status: "ok",
      data: deployment,
      // Painted, because the variables are a table the CLI coloured. A pipe
      // gets the object itself.
      pretty: shows
        ? painted(
            [
              this.tabulateDetail(deployment.id, DEPLOYMENT_FIELDS, deploymentRow(deployment)),
              ...(frozen === undefined ? [] : ["", frozen]),
            ].join("\n"),
          )
        : json(deployment),
    });
  }
}
