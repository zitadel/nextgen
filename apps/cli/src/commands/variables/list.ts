import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { environmentParam, renderVariableTable, toVariableRows } from "../../lib/variables";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables list` topic command — show the variables entered at one owner.
 *
 * Owners are separate, not a ladder: `--environment` reads that environment,
 * omitting it reads the project level, and neither sees the other (ADR 062
 * §4). A secret is reported as held without its value, because the platform
 * never discloses one.
 */
export default class VariablesList extends BaseCommand {
  static override description = "List the variables entered on an environment or the project.";
  static override group = CommandGroups.configuration;
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Environment to read. Omit to read the project level.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    const { flags } = await this.parse(VariablesList);
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source } = this.meta;
    const environment = flags.environment;

    const secret = await readZitadelSecret(cwd);
    // Stated to a human, but kept off a pipe: these lines share stdout with the
    // result, so `$(zitadel variables get NAME)` would otherwise capture them
    // ahead of the value. The same rule the resource commands follow.
    if (process.stdout.isTTY) {
      consola.info(`Project   ${secret.project_id}`);
      consola.info(`Server    ${source}`);
    }
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });

    const rows = toVariableRows(
      await client.getVariables({
        project_id: secret.project_id,
        ...environmentParam(environment),
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
      pretty: renderVariableTable(rows, environment),
    });
  }
}
