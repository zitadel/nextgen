import { Args } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { assertVariableName, renderScalar, toVariableRow } from "../../lib/variables";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables get` topic command — read one variable by name at one owner.
 *
 * A name that owner has not entered answers `var.not_found`, even when another
 * owner of the same project holds it: nothing is inherited (ADR 062 §4). A
 * secret is found but not disclosed, so the answer says it is held and nothing
 * more.
 */
export default class VariablesGet extends EnvironmentCommand {
  static override description = "Get one variable from an environment or the project.";
  static override group = CommandGroups.configuration;
  static override args = {
    name: Args.string({ required: true, description: "Variable name to read." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesGet);
    await this.toMeta(flags);
    const { cwd, source } = this.meta;
    const name = args.name;

    assertVariableName(name);

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
    const environment = await this.resolveOwner(client, secret.project_id);

    // The single-name endpoint answers in the same two forms the collection
    // does, so the row projection is shared rather than duplicated.
    const row = toVariableRow(
      name,
      await client.getVariable(name, {
        project_id: secret.project_id,
        ...(environment ? { environment_name: environment } : {}),
      }),
    );
    this.recordTelemetry({
      is_secret: row.secret,
      is_environment_scoped: environment !== undefined,
    });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, ...row },
      pretty: row.secret
        ? `${name} is held on ${ownerLabel(environment)} (secret)`
        : renderScalar(row.value),
    });
  }
}
