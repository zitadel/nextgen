import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { renderDetail } from "../../lib/oclif/crud/table";
import {
  assertVariableName,
  toVariableRow,
  variableCells,
  variableScope,
} from "../../lib/variables";

/**
 * `zitadel variable get NAME` — read one variable by name from the project.
 *
 * A name the project has not entered answers `var.not_found`. A secret is found
 * but not disclosed, so the answer says it is held and nothing more. `--preview`
 * reads the override a preview deploy prefers instead of the frozen value; a
 * name with no preview override is a miss under `--preview`.
 */
export default class VariableGet extends EnvironmentCommand {
  static override description = "Get one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable get API_URL --preview",
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID --json",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "Variable name to read." }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Read the preview override instead of the value every deploy freezes.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariableGet);
    await this.toMeta(flags);
    const name = args.name;

    assertVariableName(name);
    const { client, projectId } = await this.connect();
    const scope = variableScope(projectId, flags.preview);

    // The single-name endpoint answers in the same two forms the collection
    // does, so the row projection is shared rather than duplicated.
    const row = toVariableRow(name, await client.getVariable(name, scope));
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
