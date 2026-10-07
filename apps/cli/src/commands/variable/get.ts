import { CommandGroups, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { renderDetail } from "../../lib/oclif/crud/table";
import { assertVariableName, toVariableRow, variableCells } from "../../lib/variables";
import { VariableCommand } from "../../lib/variable-command";

/**
 * `zitadel variable get` — read one variable by name. A secret is found but not
 * disclosed, so the answer says it is held and nothing more.
 */
export default class VariableGet extends VariableCommand {
  static override description = "Get one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID --preview --json",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "Variable name to read." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariableGet);
    await this.toMeta(flags);
    const name = args.name;

    assertVariableName(name);
    const { client, scope } = await this.connect();

    const row = toVariableRow(
      name,
      await client.getVariable(name, { ...scope, applies_to: this.appliesTo(flags) }),
    );
    this.recordTelemetry({ is_secret: row.secret });

    const data = row;
    // A pipe receives the whole record, which carries no `value` for a secret.
    if (!process.stdout.isTTY) {
      return this.emit({ status: "ok", data, pretty: JSON.stringify(data, null, 2) });
    }
    const [cell] = variableCells([row]);
    return this.emit({
      status: "ok",
      data,
      pretty: renderDetail(name, ["value"], {
        value: cell?.value === "" ? '""' : cell?.value,
      }),
    });
  }
}
