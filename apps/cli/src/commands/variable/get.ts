import { Flags } from "@oclif/core";

import { ZitadelError } from "../../lib/errors";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { variableNameArg } from "../../lib/oclif/inputs/variables";
import { Tabulatable } from "../../lib/oclif/tabulatable";
import { toVariableRow, variableCells, variableReadScope } from "../../lib/variables";

/**
 * `zitadel variable get NAME` — read one variable by name from the project.
 *
 * A name the project has not entered answers `var.not_found`. A secret is found
 * but not disclosed, so the answer says it is held and nothing more. Without
 * `--preview` it reads the primary value; with it, the preview value. A name with
 * no value of the kind asked for is a miss.
 */
export default class VariableGet extends Tabulatable(EnvironmentCommand) {
  static override description = "Get one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable get API_URL --preview",
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID --json",
  ];
  static override args = {
    name: variableNameArg({ required: true, description: "Variable name to read." }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Read the preview value instead of the primary one.",
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof VariableGet>): Promise<JsonEnvelope> {
    const name = args.name;
    const { client, projectId } = await this.connect();
    const scope = variableReadScope(projectId, flags.preview);

    // The single-name endpoint answers in the same two forms the collection
    // does, so the row projection is shared rather than duplicated.
    const value = (await client.getVariable(name, scope))[scope.kind];
    if (value === undefined) {
      throw new ZitadelError("E_NOT_FOUND", `Variable ${name} has no ${scope.kind} value.`, {
        hint: flags.preview
          ? "A name has a preview value only once one is set with `--preview`."
          : "Set one with `variable set`.",
      });
    }
    const row = toVariableRow(name, value);
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
      pretty: this.tabulateDetail(name, ["value"], {
        // The detail view drops an empty field, which would hide a value that
        // is legitimately the empty string.
        value: cell?.value === "" ? '""' : cell?.value,
      }),
    });
  }
}
