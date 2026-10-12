import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope, PreviewCommand } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";

/** The columns `list` renders, in order. */
const COLUMNS = ["url", "expires", "created"] as const;

/**
 * `zitadel preview list` — show the project's live previews.
 *
 * Newest first: the preview URL, when it expires and when it was first
 * deployed. An expired or removed preview is not listed. Read with the preview
 * credential, so it works from a pull-request build.
 */
export default class PreviewList extends PreviewCommand {
  static override description = "List the project's live previews, newest first.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> preview list",
    "<%= config.bin %> preview list --plain",
  ];
  static override flags = {
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PreviewList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const { previews } = await client.listPreviews({ project_id: projectId });
    const rows = previews.map((preview) => ({
      url: preview.origin,
      expires: preview.expires_at,
      created: preview.created_at,
    }));

    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { previews, count: previews.length },
      pretty: plain
        ? renderRows(COLUMNS, rows)
        : rows.length === 0
          ? "No live previews."
          : [
              renderTable(COLUMNS, rows),
              "",
              `${rows.length} ${rows.length === 1 ? "preview" : "previews"}`,
            ].join("\n"),
    });
  }
}
