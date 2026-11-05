import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { variableNameArg } from "./name";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { deletedData } from "../../lib/oclif/envelope";
import { variableScope } from "../../lib/variables";
import { Destructive } from "../../lib/oclif/destructive";

/**
 * `zitadel variable rm NAME` — remove one variable from the project.
 *
 * `--preview` removes the preview value and leaves the primary one standing;
 * without it the variable is removed for both kinds.
 */
export default class VariableRm extends Destructive(EnvironmentCommand) {
  static override description = "Remove one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable rm GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable rm API_URL --preview",
    "<%= config.bin %> variable rm GOOGLE_CLIENT_ID --force",
  ];
  static override args = {
    name: variableNameArg({ required: true, description: "Variable name to remove." }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Remove the preview value alone, leaving the primary one standing.",
    }),
    // `--force` is per command, not global: here it permits a removal.
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the variable without the confirmation prompt. Required when non-interactive.",
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof VariableRm>): Promise<JsonEnvelope> {
    const kinds = flags.preview ? ["preview"] : ["primary", "preview"];

    return this.emit(
      await this.confirmed({
        verb: "remove",
        name: `remove ${args.name} from the project`,
        message: `Remove ${args.name} from the project?`,
        preview: () => {
          const preview = dryRunResult("remove", "variable", args.name);
          return {
            ...preview,
            data: { ...(preview.data as object), kinds },
            pretty: `${preview.pretty} from the project${flags.preview ? " (preview)" : ""}`,
          };
        },
        prepare: () => this.connect(),
        apply: async (consent, { client, projectId }) => {
          await consent
            .unlock(client)
            .deleteVariable(args.name, variableScope(projectId, flags.preview));
          return {
            status: "ok",
            data: { ...deletedData({ name: args.name }), kinds },
            pretty: `Removed ${args.name} from the project${flags.preview ? " (preview)" : ""}`,
          };
        },
      }),
    );
  }
}
