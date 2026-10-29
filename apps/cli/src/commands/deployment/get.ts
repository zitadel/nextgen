import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { renderDetail } from "../../lib/oclif/crud/table";
import { frozenVariables, toVariableRows } from "../../lib/variables";
import { DEPLOYMENT_FIELDS, deploymentRow } from "./list";

/**
 * `zitadel deployment get <deployment_id>` — read one deployment record: the
 * release it made live, the origins it went to, when, and the variables it
 * froze.
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

    const scope = { project_id: projectId };
    // Only the terminal rendering names the frozen set, so only it asks for
    // one: `--json` carries the record exactly as the API serves it, and a
    // pipe carries the record too.
    const shows = !this.jsonEnabled() && process.stdout.isTTY === true;
    const [deployment, variables] = await Promise.all([
      client.getDeploymentById(args.deployment_id, scope),
      shows ? client.getDeploymentVariables(args.deployment_id, scope) : undefined,
    ]);

    // One record reads the same here as it does from any other `get`: the
    // identifier, then a labelled line per field, at the left margin and
    // named as the wire names them, with the set the deployment froze tabled
    // under them. A pipe gets the object itself, because a script wants the
    // record rather than a view of it.
    const detail = [
      renderDetail(deployment.id, DEPLOYMENT_FIELDS, deploymentRow(deployment)),
      ...(variables === undefined ? [] : [frozenVariables(toVariableRows(variables))]),
    ].join("\n\n");
    return this.emit({
      status: "ok",
      data: deployment,
      pretty: shows ? detail : JSON.stringify(deployment, null, 2),
    });
  }
}
