import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { CommandGroups, type JsonEnvelope, nonBlankArg, PreviewCommand } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import { publicCliCommand } from "../../lib/public-cli";

/**
 * `zitadel preview rm <url>` — end a live preview before it expires.
 *
 * The URL stops being served at once; the deployments to it stay in the
 * history. Idempotent on the server, but destructive from the caller's point of
 * view, so it takes the same `--force`-or-confirm gate the resource deletes use.
 */
export default class PreviewRm extends PreviewCommand {
  static override description = "Remove a live preview from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> preview rm https://acme-git-sso-acmeinc.vercel.app",
    "<%= config.bin %> preview rm https://acme-git-sso-acmeinc.vercel.app --force",
  ];
  static override args = {
    url: nonBlankArg({ required: true, description: "The preview URL to remove." }),
  };
  static override flags = {
    // `--force` is per command, not global: here it permits a removal.
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the preview without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(PreviewRm);
    await this.toMeta(flags);
    const { nonInteractive, dryRun, force, cliVersion } = this.meta;
    const url = args.url;

    // A dry run makes no request, so it answers before the connection — the
    // order the resource deletes use, which keeps `--dry-run --non-interactive`
    // usable.
    if (dryRun) {
      const preview = dryRunResult("remove", "preview", url);
      return this.emit({ ...preview, pretty: `${preview.pretty} from the project` });
    }

    if (!force) {
      if (nonInteractive) {
        const retry = publicCliCommand(
          `preview rm ${url} --force${this.environmentSelector()}`,
          cliVersion,
        );
        throw new ZitadelError(
          "E_VALIDATION",
          "Removing a preview requires --force in non-interactive mode",
          {
            hint: `Pass --force to remove ${url} from the project.`,
            nextCommands: [retry],
          },
        );
      }
      const answer = await confirm({
        message: `Remove ${url} from the project?`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Remove cancelled.");
        return this.emit({ status: "skipped", reason: "remove-cancelled" });
      }
    }

    const { client, projectId } = await this.connect();

    await client.removePreview({ origin: url }, { project_id: projectId });

    return this.emit({
      status: "ok",
      data: { url, removed: true },
      pretty: `Stopped serving ${url}`,
    });
  }
}
