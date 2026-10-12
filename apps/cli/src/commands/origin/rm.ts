import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import { publicCliCommand } from "../../lib/public-cli";

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
    const { nonInteractive, dryRun, force, cliVersion } = this.meta;
    const pattern = args.pattern;

    // A dry run makes no request, so it answers before the connection — the
    // order the resource commands' `delete` uses, which keeps
    // `--dry-run --non-interactive` usable.
    if (dryRun) {
      const preview = dryRunResult("remove", "origin", pattern);
      return this.emit({ ...preview, pretty: `${preview.pretty} from the project` });
    }

    if (!force) {
      if (nonInteractive) {
        // A preview pattern can carry a `*`, so the retry is copy-pasteable only
        // if the shell will not expand it: single-quote any pattern holding a
        // glob or other special character before interpolating it.
        const quoted = /[^A-Za-z0-9._:/@%+-]/.test(pattern)
          ? `'${pattern.replaceAll("'", `'\\''`)}'`
          : pattern;
        const retry = publicCliCommand(
          `origin rm ${quoted} --force${this.environmentSelector()}`,
          cliVersion,
        );
        throw new ZitadelError(
          "E_VALIDATION",
          "Removing an origin requires --force in non-interactive mode",
          {
            hint: `Pass --force to remove ${pattern} from the project.`,
            nextCommands: [retry],
          },
        );
      }
      const answer = await confirm({
        message: `Remove ${pattern} from the project?`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Remove cancelled.");
        return this.emit({ status: "skipped", reason: "remove-cancelled" });
      }
    }

    const { client, projectId } = await this.connect();

    await client.removeOrigin(projectId, { pattern });

    return this.emit({
      status: "ok",
      data: { pattern, removed: true },
      pretty: `Stopped admitting ${pattern}`,
    });
  }
}
