import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderVariableTable, toVariableRows } from "../../lib/variables";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables list` topic command — show the variables entered at one owner.
 *
 * Owners are separate, not a ladder: an environment does not see the project
 * level's variables, nor the project level an environment's (ADR 062 §4). A
 * secret is reported as held without its value, because the platform never
 * discloses one.
 */
export default class VariablesList extends EnvironmentCommand {
  static override description = "List the variables entered on an environment or the project.";
  static override group = CommandGroups.configuration;

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariablesList);
    await this.toMeta(flags);
    const { cwd, source } = this.meta;

    const secret = await readZitadelSecret(cwd);
    // Stated to a human, but kept off a pipe: these lines share stdout with the
    // result, so a piped `list` would count them as rows. The same rule the
    // resource commands follow.
    if (process.stdout.isTTY) {
      consola.info(`Project   ${secret.project_id}`);
      consola.info(`Server    ${source}`);
    }
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    const environment = await this.resolveOwner(client, secret.project_id);

    const rows = toVariableRows(
      await client.getVariables({
        project_id: secret.project_id,
        ...(environment ? { environment_name: environment } : {}),
      }),
    );
    this.recordTelemetry({
      variable_count: rows.length,
      is_environment_scoped: environment !== undefined,
    });

    return this.emit({
      status: "ok",
      data: {
        environment: environment ?? null,
        variables: rows,
        count: rows.length,
      },
      pretty: renderVariableTable(rows, ownerLabel(environment)),
    });
  }
}
