import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "@/lib/oclif";
import { OriginService } from "@/lib/backend";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { deletedData } from "@/lib/oclif/envelope";
import { reportWarning } from "@/lib/warnings";
import { Destructive } from "@/lib/oclif/destructive";
import { errorMessage } from "@/lib/errors";
import { prose } from "@/lib/oclif/rendering";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * `zitadel origin rm <pattern>` — remove one origin pattern from the project.
 *
 * It says what stops being admitted. Removing a preview pattern leaves its live
 * previews to expire on their own.
 */
export default class OriginRm extends Destructive(EnvironmentCommand) {
  static override description = "Remove an origin pattern from the project.";
  static override group = CommandGroups.configuration;

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
  static override flags = {
    // `--force` is per command, not global: here it permits a removal.
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the pattern without the confirmation prompt. Required when non-interactive.",
    }),
  };

  protected async execute({ args }: Admitted<typeof OriginRm>): Promise<JsonEnvelope> {
    return this.emit(
      await this.confirmed({
        verb: "remove",
        name: `remove ${args.pattern} from the project`,
        message: async () => {
          const { projectId, server } = await this.connect();
          return `Remove ${args.pattern} from project ${escapeControlCharacters(projectId)} on ${escapeControlCharacters(server.replace(/^https?:\/\//, ""))}?`;
        },
        preview: () => {
          return dryRunResult({
            verb: "remove",
            topic: "origin",
            id: args.pattern,
            clause: "from the project",
          });
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const originService = new OriginService(consent.unlock(client), projectId);
          const removal = await originService.remove(args.pattern);
          const data = deletedData({
            pattern: args.pattern,
          });
          switch (removal.outcome) {
            case "removed": {
              return {
                status: "ok",
                data,
                summary: {
                  title: `Removed ${escapeControlCharacters(removal.pattern)} from the project's origins`,
                  sections: [],
                },
              };
            }
            case "emptied": {
              // Named in the text, not as a next command: the URL is the developer's
              // to fill in, and an unquoted `<url>` placeholder is a shell redirection, so the placeholder is quoted.
              reportWarning(
                `${removal.pattern} was the project's last origin, so the project now admits no origin except a loopback origin. Add the ones it should admit with ${this.suggest("origin add '<your-app-url>' --kind primary")}.`,
              );
              return {
                status: "ok",
                data,
                pretty: prose(
                  `Removed ${removal.pattern}; the project has no origins left and admits no origin except a loopback origin`,
                ),
                summary: {
                  title: `Removed ${escapeControlCharacters(removal.pattern)}`,
                  sections: [],
                  lines: [
                    "The project has no origins left and admits no origin except a loopback origin",
                  ],
                },
              };
            }
            case "unverified": {
              reportWarning(
                `${removal.pattern} was removed, but the project's remaining origins could not be read: ${errorMessage(removal.cause)}`,
              );
              return {
                status: "ok",
                data,
                summary: {
                  title: `Removed ${escapeControlCharacters(removal.pattern)} from the project's origins`,
                  sections: [],
                },
              };
            }
          }
        },
      }),
    );
  }
}
