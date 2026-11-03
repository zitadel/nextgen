import { Flags } from "@oclif/core";

import { VariableService } from "../../lib/backend";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "../../lib/oclif";
import { Tabulatable } from "../../lib/oclif/tabulatable";

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
    name: nonBlankArg({ required: true, description: "Variable name to read." }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Read the preview value instead of the primary one.",
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof VariableGet>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const variableService = new VariableService(client, projectId);
    const variable = await variableService.get(args.name, flags.preview ? "preview" : "primary");
    this.recordTelemetry({ is_secret: variable.secret });

    if (!this.isOnScreen) {
      return this.emit({
        status: "ok",
        data: variable,
        pretty: JSON.stringify(variable, null, 2),
      });
    }
    const { value } = variable.cell();
    return this.emit({
      status: "ok",
      data: variable,
      pretty: this.tabulateDetail(args.name, ["value"], { value: value === "" ? '""' : value }),
    });
  }
}
