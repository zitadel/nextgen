import { CommandGroups, type JsonEnvelope, nonBlankArg, OwnerCommand } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { renderDetail } from "../../lib/oclif/crud/table";
import { assertVariableName, toVariableRow, variableCells } from "../../lib/variables";

/**
 * The `variables get` topic command — read one variable by name at the project
 * level.
 *
 * A name the project has not entered answers `var.not_found`. A secret is found
 * but not disclosed, so the answer says it is held and nothing more.
 */
export default class VariablesGet extends OwnerCommand {
  static override description = "Get one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variables get GOOGLE_CLIENT_ID --project-level",
    "<%= config.bin %> variables get GOOGLE_CLIENT_ID --project-level --json",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "Variable name to read." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesGet);
    await this.toMeta(flags);
    const name = args.name;

    assertVariableName(name);
    const { client, scope } = await this.connect();

    // The single-name endpoint answers in the same two forms the collection
    // does, so the row projection is shared rather than duplicated.
    const { primary } = await client.getVariable(name, { ...scope, kind: "primary" });
    if (primary === undefined) {
      throw new ZitadelError("E_NOT_FOUND", `Variable ${name} has no primary value.`);
    }
    const row = toVariableRow(name, primary);
    this.recordTelemetry({ is_secret: row.secret });

    const data = row;
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
      pretty: renderDetail(name, ["value"], {
        // The detail view drops an empty field, which would hide a value that
        // is legitimately the empty string.
        value: cell?.value === "" ? '""' : cell?.value,
      }),
    });
  }
}
