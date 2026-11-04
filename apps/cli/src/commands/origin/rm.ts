import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "../../lib/oclif";
import { OriginService, type OriginRemoval } from "../../lib/backend";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { deletedData } from "../../lib/oclif/envelope";
import { reportWarning } from "../../lib/warnings";
import { Destructive } from "../../lib/oclif/destructive";
import { errorMessage } from "../../lib/errors";

/** What to tell the person about a removal, by what it left the project admitting. */
function describeRemoval(removal: OriginRemoval, selector: string) {
  const { pattern } = removal;
  switch (removal.outcome) {
    case "removed":
      return {
        pretty: `Removed ${pattern} from the project's origins`,
      };
    case "emptied":
      return {
        pretty: `Removed ${pattern}; the project has no origins left and admits every origin`,
        // Named in the text, not as a next command: the URL is the developer's
        // to fill in, and a `<url>` placeholder is a shell redirection.
        warning: `${pattern} was the project's last origin, so the project now admits every origin. Add the ones it should admit with \`zitadel origin add <url> --kind primary${selector}\`.`,
      };
    case "unverified":
      return {
        pretty: `Removed ${pattern} from the project's origins`,
        warning: `${pattern} was removed, but the project's remaining origins could not be read: ${errorMessage(removal.cause)}`,
      };
  }
}

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
        message: `Remove ${args.pattern} from the project?`,
        preview: () => {
          const result = dryRunResult("remove", "origin", args.pattern);
          return {
            ...result,
            pretty: `${result.pretty} from the project`,
          };
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const originService = new OriginService(consent.unlock(client), projectId);
          const removal = await originService.remove(args.pattern);
          const { warning, pretty } = describeRemoval(removal, this.environmentSelector());
          if (warning !== undefined) {
            reportWarning(warning);
          }
          return {
            status: "ok",
            data: deletedData({
              pattern: args.pattern,
            }),
            pretty,
          };
        },
      }),
    );
  }
}
