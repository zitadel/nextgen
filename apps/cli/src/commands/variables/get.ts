import { Args } from "@oclif/core";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderDetail } from "../../lib/oclif/crud/table";
import { assertVariableName, toVariableRow, variableCells } from "../../lib/variables";

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
  static override examples = [
    "<%= config.bin %> variables get GOOGLE_CLIENT_ID --environment prod",
    "<%= config.bin %> variables get GOOGLE_CLIENT_ID --environment prod --json",
  ];
  static override args = {
    name: Args.string({ required: true, description: "Variable name to read." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesGet);
    await this.toMeta(flags);
    const name = args.name;

    assertVariableName(name);
    const { client, scope, environment } = await this.connect();

    // The single-name endpoint answers in the same two forms the collection
    // does, so the row projection is shared rather than duplicated.
    const row = toVariableRow(name, await client.getVariable(name, scope));
    this.recordTelemetry({
      is_secret: row.secret,
      is_environment_scoped: environment !== undefined,
    });

    const data = { environment: environment ?? null, ...row };
    // The resource commands' `get`: a pipe receives the whole record, since a
    // script wants the record rather than a view of it. That is also what keeps
    // a secret from being mistaken for a value — it reads `"secret": true` and
    // carries no `value` at all.
    if (!process.stdout.isTTY) {
      return this.emit({ status: "ok", data, pretty: JSON.stringify(data, null, 2) });
    }
    const [cell] = variableCells([row]);
    return this.emit({
      status: "ok",
      data,
      pretty: renderDetail(name, ["environment", "value"], {
        environment: ownerLabel(environment),
        // The detail view drops an empty field, which would hide a value that
        // is legitimately the empty string.
        value: cell?.value === "" ? '""' : cell?.value,
      }),
    });
  }
}
