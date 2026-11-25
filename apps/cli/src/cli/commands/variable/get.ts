import { Flags } from "@oclif/core";

import { BackendNotFoundError, VariableService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { fieldsFlag } from "@/cli/core/tabulatable";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { VariableView } from "@/lib/variable";
import { ReadCommand } from "@/cli/commands/bases";
import { variableNameArg } from "./name";
import { Telemetered } from "@/cli/telemetry/telemetered";

const PREVIEW_NOT_FOUND_REFUSAL = {
  code: "E_NOT_FOUND",
  message: "{message}",
  hint: "A name has a preview value only once one is set with `--preview`.",
} as const satisfies Refusal;

const PRIMARY_NOT_FOUND_REFUSAL = {
  code: "E_NOT_FOUND",
  message: "{message}",
  hint: "Set one with `variable set`.",
} as const satisfies Refusal;

/**
 * `zitadel variable get NAME` — read one variable by name from the project.
 *
 * A name the project has not entered answers `var.not_found`. A secret is found
 * but not disclosed, so the answer says it is held and nothing more. Without
 * `--preview` it reads the primary value; with it, the preview value. A name with
 * no value of the kind asked for is a miss. `--fields` cuts the data and the
 * rows to the dot-paths it names, judged by the record's shape.
 */
export default class VariableGet extends Telemetered(ReadCommand) {
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
        /**
         * The keys of {@link Variable}'s JSON that a single read carries; `variable list` adds the preview.
         */
        known: new Set(["name", "secret", "value"]),
        open: [],
      },
    }),
  };

  /**
   * Reads one variable and shows it.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The variable, as a record.
   */
  protected async execute({ args, flags }: Admitted<typeof VariableGet>): Promise<CommandResult> {
    const variableService = await this.service(VariableService);
    try {
      const variable = await variableService.get(args.name, flags.preview ? "preview" : "primary");
      this.annotate({
        is_secret: variable.secret,
      });

      const title = `Read ${escapeControlCharacters(args.name)}`;
      const cell = VariableView.of(variable).cell();
      const view = this.viewRecord(variable, flags.fields, ["value"]);

      return {
        status: "ok",
        data: view.data,
        summary: {
          title,
          sections: [],
          lines: this.tabulateDetail(undefined, view.columns, {
            name: variable.name,
            secret: variable.secret,
            value: cell.value === "" ? '""' : cell.value,
          }).split("\n"),
        },
      };
    } catch (error) {
      if (error instanceof BackendNotFoundError && flags.preview) {
        throw refusalError(PREVIEW_NOT_FOUND_REFUSAL, {
          message: error.message,
        });
      }
      if (error instanceof BackendNotFoundError) {
        throw refusalError(PRIMARY_NOT_FOUND_REFUSAL, {
          message: error.message,
        });
      }
      throw error;
    }
  }
}
