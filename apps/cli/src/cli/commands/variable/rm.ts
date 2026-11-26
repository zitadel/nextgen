import { Flags } from "@oclif/core";

import { VariableRemoval, VariableService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { deletedData } from "@/cli/core/envelope";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { RemoveCommand } from "@/cli/commands/bases";
import { variableNameArg } from "./name";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * `zitadel variable rm NAME` — remove one variable from the project.
 *
 * `--preview` removes the preview value and leaves the primary one standing;
 * without it the variable is removed for both kinds.
 */
export default class VariableRm extends Telemetered(
  RemoveCommand(
    "Remove the variable without the confirmation prompt. Required when non-interactive.",
  ),
) {
  static override description = "Remove one variable from the project.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 4;

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
  };

  /**
   * Says what removing the variable would do, without connecting or removing.
   * This is the one place the run reads `--preview` as a decision: the removal
   * owns which kinds it clears from here on.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ args, flags }: Admitted<typeof VariableRm>): Promise<CommandResult> {
    const removal = VariableRemoval.of({
      preview: flags.preview,
    });
    const result = dryRunResult({
      verb: "remove",
      topic: "variable",
      id: args.name,
      clause: `from the project${removal.preview ? " (preview)" : ""}`,
      next: await this.realRun(),
    });

    return {
      ...result,
      data: {
        ...(result.data as object),
        kinds: removal.kinds,
      },
    };
  }

  /**
   * Removes the variable, once the person has agreed or forced it.
   *
   * @param input - The flags and arguments of the run.
   * @returns The envelope of the removal.
   */
  protected async apply({ args, flags }: Admitted<typeof VariableRm>): Promise<CommandResult> {
    const removal = VariableRemoval.of({
      preview: flags.preview,
    });
    const suffix = removal.preview ? " (preview)" : "";

    return await this.confirmed({
      verb: "remove",
      name: `remove ${removal.preview ? "the preview value of " : ""}${args.name} from the project`,
      message: async () => {
        const what = removal.preview ? "the preview value of " : "";
        return `Remove ${what}${args.name} from ${await this.projectOnServer()}?`;
      },
      apply: async (consent) => {
        const variableService = await this.service(VariableService, consent);
        await variableService.remove(args.name, removal);
        const title = `Removed ${escapeControlCharacters(args.name)} from the project${suffix}`;

        return {
          status: "ok",
          data: {
            ...deletedData({
              title,
              name: args.name,
            }),
            kinds: removal.kinds,
          },
          summary: {
            title,
            sections: [],
          },
        };
      },
    });
  }
}
