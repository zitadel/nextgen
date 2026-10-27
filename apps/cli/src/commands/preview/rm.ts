import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope, nonBlankArg, PreviewCommand } from "../../lib/oclif";
import { collectPages } from "../../lib/oclif/crud/paging";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { deletedData } from "../../lib/oclif/envelope";
import { shellArg } from "../../lib/shell";
import { Promptable } from "../../lib/oclif/promptable";

/**
 * `zitadel preview rm <url>` — end a live preview before it expires.
 *
 * The URL stops being served at once; the deployments to it stay in the
 * history. Idempotent on the server, but destructive from the caller's point of
 * view, so it takes the same `--force`-or-confirm gate the resource deletes use.
 */
export default class PreviewRm extends Promptable(PreviewCommand) {
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
    const { dryRun } = this.meta;
    // An origin has no path, so a trailing slash is the same URL; sent as
    // typed it would remove nothing and still answer 204.
    const url = args.url.replace(/\/+$/, "");

    // A dry run makes no request, so it answers before the connection — the
    // order the resource deletes use, which keeps `--dry-run --non-interactive`
    // usable.
    if (dryRun) {
      const preview = dryRunResult("remove", "preview", url);
      return this.emit({ ...preview, pretty: `${preview.pretty} from the project` });
    }

    // Resolved before the confirmation, so the prompt is answered knowing
    // which project it removes from, and a missing token fails first.
    const { client, projectId } = await this.connect();

    // The server answers 204 whether or not the URL was live, so a typo would
    // otherwise read as a removal. Checked before asking, so nobody confirms
    // removing what is not there.
    const { items } = await collectPages(
      (token) => client.listPreviews(projectId, token === undefined ? {} : { page_token: token }),
      { items: "previews", all: true, nextPageToken: "next_page_token" },
    );
    if (!(items as Array<{ origin: string }>).some((preview) => preview.origin === url)) {
      return this.emit({
        status: "skipped",
        reason: "not-live",
        pretty: `${url} is not a live preview of the project; nothing was removed`,
        nextCommands: [this.suggest("preview list")],
      });
    }

    const confirmed = await this.ask.confirm({
      name: `remove ${url} from the project`,
      message: `Remove ${url} from the project?`,
      retry: this.suggest(`preview rm ${shellArg(url)} --force`),
    });
    if (!confirmed) {
      return this.emit({ status: "skipped", reason: "remove-cancelled" });
    }

    await client.removePreview(projectId, { origin: url });

    return this.emit({
      status: "ok",
      data: deletedData({ url }),
      pretty: `Stopped serving ${url}`,
    });
  }
}
