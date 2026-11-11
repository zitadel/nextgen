import { PreviewService } from "@/lib/backend";
import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  type Admitted,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
  PreviewCommand,
} from "@/lib/oclif";
import { reads, type Refused, whole } from "@/lib/oclif/flags";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";

/** The columns `list` renders, in order. */
const COLUMNS = ["url", "expires", "created"] as const;

/** The page sizes the server accepts, quoted by the refusal and the reference. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

/** The page size `--limit` asks for, as the server bounds it. */
const LIMIT: Refused<number> = {
  schema: whole.pipe(z.number().min(LIMIT_MIN).max(LIMIT_MAX)),
  refusal: {
    message: "{value} is not a valid {input}",
    hint: "Use a whole number from {min} to {max}.",
  },
  values: {
    min: LIMIT_MIN,
    max: LIMIT_MAX,
  },
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
export default class PreviewList extends Tabulatable(PreviewCommand) {
  static override description = "List the project's live previews, newest first.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> preview list",
    "<%= config.bin %> preview list --all",
    "<%= config.bin %> preview list --plain",
  ];
  static override flags = {
    limit: Flags.custom<number>({
      parse: reads(LIMIT),
    })({
      min: LIMIT_MIN,
      max: LIMIT_MAX,
      description: "Page size (server default 20, max 100).",
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

  protected async execute({ flags }: Admitted<typeof PreviewList>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const previewService = new PreviewService(client, projectId);
    const listed = await previewService.page(
      {
        limit: flags.limit,
        page_token: flags.pageToken,
      },
      {
        all: flags.all,
      },
    );

    const items = listed.items;
    const rows = items.map((preview) => {
      return {
        url: preview.origin,
        expires: preview.expires_at,
        created: preview.created_at,
      };
    });

    const columns = COLUMNS;
    const footer: string[] = [];
    const page = {
      token: listed.next,
      command: "preview list",
      flags: flags.limit === undefined ? [] : [`--limit ${flags.limit}`],
    };
    const extra = {};

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "preview",
      empty: "No previews found",
      footer,
      page,
      extra,
    });
  }
}
