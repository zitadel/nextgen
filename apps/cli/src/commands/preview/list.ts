import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope, nonBlankString, PreviewCommand } from "../../lib/oclif";
import { collectPages } from "../../lib/oclif/crud/paging";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { publicCliCommand } from "../../lib/public-cli";
import { shellArg } from "../../lib/shell";

/** The columns `list` renders, in order. */
const COLUMNS = ["url", "expires", "created"] as const;

/** A preview as the list endpoint returns it, narrowed to what the table reads. */
type PreviewRow = {
  origin: string;
  expires_at: string;
  created_at: string;
};

/**
 * `zitadel preview list` — show the project's live previews.
 *
 * Newest first: the preview URL, when it expires and when it was first
 * deployed. An expired or removed preview is not listed. Read with the preview
 * credential, so it works from a pull-request build. Like every list verb it
 * fetches one page and reports `next_page_token`; `--all` drains them,
 * `--limit` / `--page-token` walk them a page at a time.
 */
export default class PreviewList extends PreviewCommand {
  static override description = "List the project's live previews, newest first.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> preview list",
    "<%= config.bin %> preview list --all",
    "<%= config.bin %> preview list --plain",
  ];
  static override flags = {
    limit: Flags.integer({
      description: "Page size (server default 20, max 100).",
      min: 1,
      max: 100,
    }),
    "page-token": nonBlankString({
      description: "Continue from a previous page's next_page_token.",
    }),
    all: Flags.boolean({
      char: "a",
      description: "Fetch every page instead of one.",
      exclusive: ["page-token"],
    }),
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PreviewList);
    await this.toMeta(flags);
    const { cliVersion } = this.meta;
    const { client, projectId } = await this.connect();

    const request = (token?: string): Promise<unknown> =>
      client.listPreviews({
        project_id: projectId,
        ...(flags.limit === undefined ? {} : { limit: flags.limit }),
        ...(token === undefined ? {} : { page_token: token }),
      });

    const { items, next } = await collectPages(request, {
      items: "previews",
      all: flags.all === true,
      token: flags["page-token"],
      nextPageToken: "next_page_token",
    });
    const previews = items as PreviewRow[];

    const rows = previews.map((preview) => ({
      url: preview.origin,
      expires: preview.expires_at,
      created: preview.created_at,
    }));

    // A page token is only valid alongside the flags that issued it, so the
    // suggested next page repeats the whole invocation rather than a bare
    // token. `--all` already drained everything, so it suggests nothing.
    const nextCommand =
      next && flags.all !== true
        ? publicCliCommand(
            [
              "preview list",
              ...(flags.limit === undefined ? [] : [`--limit ${flags.limit}`]),
              `--page-token ${shellArg(next)}`,
              "--json",
            ].join(" ") + this.environmentSelector(),
            cliVersion,
          )
        : undefined;

    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: {
        items: previews,
        count: previews.length,
        next_page_token: next,
        ...(nextCommand === undefined ? {} : { next_commands: [nextCommand] }),
      },
      pretty: plain
        ? renderRows(COLUMNS, rows)
        : rows.length === 0
          ? "No live previews."
          : [
              renderTable(COLUMNS, rows),
              "",
              `${rows.length} ${rows.length === 1 ? "preview" : "previews"}`,
              ...(next ? [`More available: --page-token ${shellArg(next)} (or --all)`] : []),
            ].join("\n"),
    });
  }
}
