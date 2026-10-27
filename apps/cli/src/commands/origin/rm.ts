import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { deletedData } from "../../lib/oclif/envelope";
import { shellArg } from "../../lib/shell";
import { reportWarning } from "../../lib/warnings";
import { Promptable } from "../../lib/oclif/promptable";

/**
 * `zitadel origin rm <pattern>` — remove one origin pattern from the project.
 *
 * It says what stops being admitted. Removing a preview pattern leaves its live
 * previews to expire on their own. Destructive, so it takes the same
 * `--force`-or-confirm gate the resource commands' `delete` uses.
 */
export default class OriginRm extends Promptable(EnvironmentCommand) {
  static override description = "Remove an origin pattern from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> origin rm https://app.acme.com",
    "<%= config.bin %> origin rm https://app.acme.com --force",
  ];
  static override args = {
    pattern: nonBlankArg({ required: true, description: "The origin pattern to remove." }),
  };
  static override flags = {
    // `--force` is per command, not global: here it permits a removal.
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the pattern without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(OriginRm);
    await this.toMeta(flags);
    const { dryRun } = this.meta;
    const pattern = args.pattern;

    // A dry run makes no request, so it answers before the connection — the
    // order the resource commands' `delete` uses, which keeps
    // `--dry-run --non-interactive` usable.
    if (dryRun) {
      const preview = dryRunResult("remove", "origin", pattern);
      return this.emit({ ...preview, pretty: `${preview.pretty} from the project` });
    }

    // Resolved before the confirmation, so the prompt is answered knowing
    // which project it removes from: `connect` names it on a terminal, and
    // asks for a missing value before, not after, the removal is agreed.
    const { client, projectId } = await this.connect();

    // A preview pattern can carry a `*`, so the retry is copy-pasteable only if
    // the shell will not expand it: `shellArg` single-quotes any pattern holding
    // a glob or other special character before interpolating it.
    const confirmed = await this.input({
      kind: "confirm",
      name: `remove ${pattern} from the project`,
      message: `Remove ${pattern} from the project?`,
      retry: this.suggest(`origin rm ${shellArg(pattern)} --force`),
    });
    if (!confirmed) {
      return this.emit({ status: "skipped", reason: "remove-cancelled" });
    }

    await client.removeOrigin(projectId, { pattern });

    // An empty list admits every origin, so removing the last pattern opens the
    // project up rather than closing it: said aloud, since it is the opposite
    // of what removing one pattern otherwise does.
    // The pattern is already removed, so a failed read of what is left is said
    // aloud rather than reported as a failed removal.
    const remaining = await client.getProject(projectId).then(
      (project) => project.origins ?? [],
      (error: unknown) => {
        reportWarning(
          `${pattern} was removed, but the project's remaining origins could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      },
    );
    if (remaining?.length === 0) {
      reportWarning(
        // Named in the text, not as a next command: the URL is the developer's
        // to fill in, and a `<url>` placeholder is a shell redirection. The
        // selector keeps it on the environment that was just opened up.
        `${pattern} was the project's last origin, so the project now admits every origin. Add the ones it should admit with \`zitadel origin add <url> --kind primary${this.environmentSelector()}\`.`,
      );
    }

    return this.emit({
      status: "ok",
      data: deletedData({ pattern }),
      pretty:
        remaining?.length === 0
          ? `Removed ${pattern}; the project has no origins left and admits every origin`
          : `Removed ${pattern} from the project's origins`,
    });
  }
}
