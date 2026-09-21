import { Args, Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import {
  assertVariableName,
  environmentParam,
  ownerLabel,
  renderScalar,
  toVariableRow,
} from "../../lib/variables";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables get` topic command — read one variable by name at one owner.
 *
 * A name that owner has not entered answers `var.not_found`, even when another
 * owner of the same project holds it: nothing is inherited (ADR 062 §4). A
 * secret is found but not disclosed, so the answer says it is held and nothing
 * more.
 */
export default class VariablesGet extends BaseCommand {
  static override description = "Get one variable from an environment or the project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 6;
  static override args = {
    name: Args.string({ required: true, description: "Variable name to read." }),
  };
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Environment to read from. Omit to read the project level.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    const { args, flags } = await this.parse(VariablesGet);
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source } = this.meta;
    const environment = flags.environment;
    const name = args.name;

    assertVariableName(name);
    const owner = environmentParam(environment);

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });

    // The single-name endpoint answers in the same two forms the collection
    // does, so the row projection is shared rather than duplicated.
    const row = toVariableRow(
      name,
      await client.getVariable(name, { project_id: secret.project_id, ...owner }),
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
