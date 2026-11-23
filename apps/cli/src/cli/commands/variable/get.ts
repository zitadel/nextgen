import { Flags } from "@oclif/core";

import { VariableService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { chosenColumns } from "@/lib/oclif/columns";
import { fieldsFlag, Tabulatable } from "@/lib/oclif/tabulatable";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { VariableView } from "@/lib/variable";

import { variableNameArg } from "./name";
import { ServerCommand } from "@/cli/commands/server-command";

/**
 * `zitadel variable get NAME` — read one variable by name from the project.
 *
 * A name the project has not entered answers `var.not_found`. A secret is found
 * but not disclosed, so the answer says it is held and nothing more. Without
 * `--preview` it reads the primary value; with it, the preview value. A name with
 * no value of the kind asked for is a miss. `--fields` cuts the data and the
 * rows to the dot-paths it names, judged by the record's shape.
 */
export default class VariableGet extends Tabulatable(ServerCommand(EnvironmentCommand)) {
  static override description = "Get one variable from the project.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable get API_URL --preview",
    "<%= config.bin %> variable get GOOGLE_CLIENT_ID --json",
  ];
  static override args = {
    name: variableNameArg({
      required: true,
      description: "Variable name to read.",
    }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Read the preview value instead of the primary one.",
    }),
    fields: fieldsFlag({
      fallback: ["name"],
      shape: {
        known: new Set(["name", "secret", "value"]),
        open: [],
      },
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof VariableGet>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const variableService = new VariableService(client, projectId);
    const variable = await variableService.get(args.name, flags.preview ? "preview" : "primary");
    this.recordTelemetry({
      is_secret: variable.secret,
    });

    const title = `Read ${escapeControlCharacters(args.name)}`;
    const cell = VariableView.of(variable).cell();

    return this.emit({
      status: "ok",
      data: flags.fields === undefined ? variable : this.pickFields(variable, flags.fields),
      summary: {
        title,
        sections: [],
        lines: this.tabulateDetail(undefined, chosenColumns(flags.fields, ["value"], []), {
          name: variable.name,
          secret: variable.secret,
          value: cell.value === "" ? '""' : cell.value,
        }).split("\n"),
      },
    });
  }
}
