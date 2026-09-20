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
    // `--environment` names the owner on the platform, not a `zitadel.json`
    // block. `toMeta` forwards a `flags.environment` to the server resolver,
    // where a matching `environments.<name>.server` would redirect the request,
    // so the owner name is withheld and the server resolves exactly as it does
    // for a command carrying no such flag — the same resolution `plan` and
    // `apply` use by default, which is what keeps a variable and the document
    // referencing it on one platform. It does not make resolution independent
    // of `zitadel.json`: an `environments.development.server` override still
    // applies, as it does to every other command. The resolved server is
    // printed below so the target is never silent.
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
