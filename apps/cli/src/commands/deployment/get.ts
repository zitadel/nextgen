import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { frozenVariables, toVariableRows } from "../../lib/variables";

/**
 * `zitadel deployment get <deployment_id>` — read one deployment record: the
 * release it made live, the origins it went to, when, and the variables it
 * froze.
 */
export default class DeploymentGet extends EnvironmentCommand {
  static override description = "Read one deployment by id.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> deployment get dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"];
  static override args = {
    deployment_id: nonBlankArg({ required: true, description: "The deployment to read." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(DeploymentGet);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const scope = { project_id: projectId };
    // `--json` carries the record alone, so only a person's view reads the
    // frozen set.
    const [deployment, variables] = await Promise.all([
      client.getDeploymentById(args.deployment_id, scope),
      this.jsonEnabled() ? undefined : client.getDeploymentVariables(args.deployment_id, scope),
    ]);

    const origins = deployment.targets.map((target) => target.origin);
    return this.emit({
      status: "ok",
      data: deployment,
      pretty: [
        `${deployment.id}`,
        `  release   ${deployment.release_id}`,
        `  reason    ${deployment.metadata.reason ?? "deploy"}`,
        `  deployed  ${deployment.deployed_at}`,
        `  origins   ${origins.join(", ")}`,
        ...(variables === undefined ? [] : ["", frozenVariables(toVariableRows(variables))]),
      ].join("\n"),
    });
  }
}
