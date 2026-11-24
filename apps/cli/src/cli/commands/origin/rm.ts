import { OriginService } from "@/lib/backend";
import { errorMessage } from "@/lib/errors";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankArg } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { deletedData } from "@/cli/core/envelope";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import { RemoveCommand } from "@/cli/commands/bases";

/**
 * `zitadel origin rm <pattern>` — remove one origin pattern from the project.
 *
 * It says what stops being admitted. Removing a preview pattern leaves its live
 * previews to expire on their own.
 */
export default class OriginRm extends RemoveCommand(
  "Remove the pattern without the confirmation prompt. Required when non-interactive.",
) {
  static override description = "Remove an origin pattern from the project.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 3;

  static override examples = [
    "<%= config.bin %> origin rm https://app.acme.com",
    "<%= config.bin %> origin rm https://app.acme.com --force",
  ];
  static override args = {
    pattern: nonBlankArg({
      required: true,
      description: "The origin pattern to remove.",
    }),
  };

  /**
   * Says which origin pattern would be removed, without removing it.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ args }: Admitted<typeof OriginRm>): Promise<CommandResult> {
    return dryRunResult({
      verb: "remove",
      topic: "origin",
      id: args.pattern,
      clause: "from the project",
      next: await this.realRun(),
    });
  }

  /**
   * Removes the origin pattern, after asking. When it was the project's last
   * origin the warning names the follow-up in its text, not as a next command:
   * the URL is the developer's to fill in, and an unquoted placeholder is a
   * shell redirection, so the placeholder is quoted.
   *
   * @param input - The flags and arguments of the run.
   * @returns The run's envelope.
   */
  protected async apply({ args }: Admitted<typeof OriginRm>): Promise<CommandResult> {
    return await this.confirmed({
      verb: "remove",
      name: `remove ${args.pattern} from the project`,
      message: async () => {
        return `Remove ${args.pattern} from ${await this.projectOnServer()}?`;
      },
      apply: async (consent) => {
        const originService = await this.service(OriginService, consent);
        const removal = await originService.remove(args.pattern);
        const removed = `Removed ${escapeControlCharacters(removal.pattern)} from the project's origins`;
        const emptied = `Removed ${escapeControlCharacters(removal.pattern)}`;
        switch (removal.outcome) {
          case "removed": {
            return {
              status: "ok",
              data: deletedData({ title: removed, pattern: args.pattern }),
              summary: {
                title: removed,
                sections: [],
              },
            };
          }
          case "emptied": {
            warnings.report(
              `${removal.pattern} was the project's last origin, so the project now admits no origin except a loopback origin. Add the ones it should admit with ${this.suggest(
                {
                  id: "origin:add",
                  args: { pattern: "<your-app-url>" },
                  flags: { kind: "primary" },
                },
              )}.`,
            );
            return {
              status: "ok",
              data: deletedData({ title: emptied, pattern: args.pattern }),
              summary: {
                title: emptied,
                sections: [],
                lines: [
                  "The project has no origins left and admits no origin except a loopback origin",
                ],
              },
            };
          }
          case "unverified": {
            warnings.report(
              `${removal.pattern} was removed, but the project's remaining origins could not be read: ${errorMessage(removal.cause)}`,
            );
            return {
              status: "ok",
              data: deletedData({ title: removed, pattern: args.pattern }),
              summary: {
                title: removed,
                sections: [],
              },
            };
          }
        }
      },
    });
  }
}
