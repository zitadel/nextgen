import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope, nonBlankString, PreviewCommand } from "../../lib/oclif";
import { plainFlag, Tabulatable } from "../../lib/oclif/tabulatable";
import { collectPages } from "../../lib/oclif/crud/paging";

/** The columns `list` renders, in order. */
const COLUMNS = ["url", "expires", "created"] as const;

/**
 * `zitadel preview list` — show the project's live previews.
 *
 * Newest first: the preview URL, when it expires and when it was first
 * deployed. An expired or removed preview is not listed. Read with the preview
 * credential, so it works from a pull-request build. Like every list verb it
 * fetches one page and reports `next_page_token`; `--all` drains them,
 * `--limit` / `--page-token` walk them a page at a time.
 */
export default class PreviewList extends Tabulatable(PreviewCommand) {
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
    plain: plainFlag,
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PreviewList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const params = {
      limit: flags.limit,
      page_token: flags["page-token"],
    };
    // One page unless `--all`, as every list does; the walk starts at
    // `--page-token`, and a drain leaves no next page to report.
    const { items, next } = await collectPages(client.listPreviews.pages(projectId, params), {
      items: (page) => page.previews,
      all: flags.all === true,
      next: (page) => page.next_page_token,
    });

    const rows = items.map((preview) => ({
      url: preview.origin,
      expires: preview.expires_at,
      created: preview.created_at,
    }));

    const columns = COLUMNS;
    const empty = "No live previews.";
    const footer: string[] = [];
    const page = {
      token: next,
      command: "preview list",
      flags: flags.limit === undefined ? [] : [`--limit ${flags.limit}`],
    };
    const extra = {};

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "preview",
      empty,
      footer,
      page,
      extra,
    });
  }
}
