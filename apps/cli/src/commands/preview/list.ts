import { Flags } from "@oclif/core";

import { relativeExpiry, shortTime } from "../../lib/deployments";
import { connectEnvironment } from "../../lib/environment";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";

const COLUMNS = ["origin", "created", "expires"] as const;

/** `zitadel preview list` — the preview URLs the project admits right now, and for how long. */
export default class PreviewList extends BaseCommand {
  static override description = "List the live preview URLs and when each expires.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> preview list", "<%= config.bin %> preview list --json"];
  static override flags = {
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(PreviewList);
    await this.toMeta(flags);
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    const { previews } = await client.listPreviews({ project_id: projectId });
    const cells = previews.map((preview) => ({
      origin: preview.origin,
      created: shortTime(preview.created_at),
      expires: relativeExpiry(preview.expires_at),
    }));
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { previews, count: previews.length },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : previews.length === 0
          ? "No live previews."
          : renderTable(COLUMNS, cells),
    });
  }
}
