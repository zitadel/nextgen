import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { renderDetail } from "../../lib/oclif/crud/table";
import { DEPLOYMENT_FIELDS, deploymentRow } from "./list";

/**
 * `zitadel deployment get <deployment_id>` — read one deployment record: the
 * release it made live, the origins it went to, and when.
 */
export default class DeploymentGet extends EnvironmentCommand {
  static override description = "Read one deployment by id.";
  static override group = CommandGroups.configuration;

  static override heading = "Reading a deployment";
  static override examples = ["<%= config.bin %> deployment get dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"];
  static override args = {
    deployment_id: nonBlankArg({ required: true, description: "The deployment to read." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(DeploymentGet);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const deployment = await client.getDeploymentById(args.deployment_id, {
      project_id: projectId,
    });

    // One record reads the same here as it does from any other `get`: the
    // identifier, then a labelled line per field, at the left margin and
    // named as the wire names them. A pipe gets the object itself, because a
    // script wants the record rather than a view of it.
    const row = deploymentRow(deployment);
    return this.emit({
      status: "ok",
      data: deployment,
      pretty: process.stdout.isTTY
        ? renderDetail(deployment.id, DEPLOYMENT_FIELDS, row)
        : JSON.stringify(deployment, null, 2),
    });
  }
}
