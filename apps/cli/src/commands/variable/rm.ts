import { Flags } from "@oclif/core";

import { VariableRemoval, VariableService } from "@/lib/backend";
import { variableNameArg } from "./name";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { Destructive } from "@/lib/oclif/destructive";
import { deletedData } from "@/lib/oclif/envelope";
import { prose } from "@/lib/oclif/rendering";

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
    name: variableNameArg({
      required: true,
      description: "Variable name to remove.",
    }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Remove the preview value alone, leaving the primary one standing.",
    }),
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the variable without the confirmation prompt. Required when non-interactive.",
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof VariableRm>): Promise<JsonEnvelope> {
    // The one place this run reads `--preview` as a decision: the removal owns
    // which kinds it clears from here on.
    const removal = VariableRemoval.of({
      preview: flags.preview,
    });
    const suffix = removal.preview ? " (preview)" : "";

    return this.emit(
      await this.confirmed({
        verb: "remove",
        name: `remove ${args.name} from the project`,
        message: `Remove ${args.name} from the project?`,
        preview: () => {
          const result = dryRunResult({
            verb: "remove",
            topic: "variable",
            id: args.name,
            clause: `from the project${suffix}`,
          });
          return {
            ...result,
            data: {
              ...(result.data as object),
              kinds: removal.kinds,
            },
          };
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const variableService = new VariableService(consent.unlock(client), projectId);
          await variableService.remove(args.name, removal);
          return {
            status: "ok",
            data: {
              ...deletedData({
                name: args.name,
              }),
              kinds: removal.kinds,
            },
            pretty: prose(`Removed ${args.name} from the project${suffix}`),
          };
        },
      }),
    );
  }
}
