import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";

/** The columns `list` renders, in order. */
const COLUMNS = ["pattern", "kind"] as const;

/**
 * `zitadel origin list` — show the project's origin patterns.
 *
 * Origins are read off the project itself, not from `zitadel.json`: they are
 * project state, so the server is the authority. An empty list means every
 * origin is admitted until the first pattern is added.
 */
export default class OriginList extends EnvironmentCommand {
  static override description = "List the origin patterns on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> origin list",
    "<%= config.bin %> origin list --plain",
  ];
  static override flags = {
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(OriginList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const origins = (await client.getProject(projectId)).origins ?? [];

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header and nothing at all when
    // empty, so `cut`, `awk` and `wc -l` work on it; a terminal gets a table.
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { items: origins, count: origins.length, next_page_token: null },
      pretty: plain
        ? renderRows(COLUMNS, origins)
        : origins.length === 0
          ? "No origins on the project."
          : [
              renderTable(COLUMNS, origins),
              "",
              `${origins.length} ${origins.length === 1 ? "origin" : "origins"}`,
            ].join("\n"),
    });
  }
}
