import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { deletedData } from "../../lib/oclif/envelope";
import { shellArg } from "../../lib/shell";

/**
 * `zitadel origin rm <pattern>` — remove one origin pattern from the project.
 *
 * It says what stops being admitted. Removing a preview pattern leaves its live
 * previews to expire on their own. Destructive, so it takes the same
 * `--force`-or-confirm gate the resource commands' `delete` uses.
 */
export default class OriginRm extends EnvironmentCommand {
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

    const { client, projectId } = await this.connect();

    await client.removeOrigin(projectId, { pattern });

    return this.emit({
      status: "ok",
      data: deletedData({ pattern }),
      pretty: `Stopped admitting ${pattern}`,
    });
  }
}
