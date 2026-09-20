import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { listVariables, ownerLabel, renderVariableTable } from "../../lib/variables";
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
  static override groupOrder = 5;
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Environment to read. Omit to read the project level.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariablesList);
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source } = this.meta;
    const environment = flags.environment;

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project       ${secret.project_id}`);
    consola.info(`Server        ${source}`);
    consola.info(`Environment   ${ownerLabel(environment)}`);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });

    const rows = await listVariables(client, secret.project_id, environment);
    this.recordTelemetry({ count: rows.length, scoped: environment !== undefined });

    return this.emit({
      status: "ok",
      data: {
        environment: environment ?? null,
        variables: rows,
        count: rows.length,
      },
      pretty: renderVariableTable(rows),
    });
  }
}
