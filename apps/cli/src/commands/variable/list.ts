import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { toVariableRows, variableCells, variableScope } from "../../lib/variables";

/** The columns `list` renders, in order. */
const COLUMNS = ["name", "value"] as const;

/**
 * `zitadel variable list` — show the variables entered on the project.
 *
 * The project's own set. A secret is reported as held without its value, because
 * the platform never discloses one. `--preview` lists the preview overrides
 * instead, not merged with the frozen values — only the names that hold one.
 */
export default class VariableList extends EnvironmentCommand {
  static override description = "List the variables entered on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable list",
    "<%= config.bin %> variable list --preview",
    "<%= config.bin %> variable list --json",
  ];
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "List the preview overrides instead of the values every deploy freezes.",
    }),
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariableList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();
    const scope = variableScope(projectId, flags.preview);

    const rows = toVariableRows(await client.getVariables(scope));
    this.recordTelemetry({ variable_count: rows.length });

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header and nothing at all when
    // empty, so `cut`, `awk` and `wc -l` work on it; a terminal gets a table.
    const cells = variableCells(rows);
    const plain = flags.plain || !process.stdout.isTTY;
    const empty = flags.preview
      ? "No preview overrides on the project."
      : "No variables on the project.";
    return this.emit({
      status: "ok",
      data: {
        // The canonical list envelope every list command emits, so an agent can
        // read any of them through `{ items, count, next_page_token }`. This
        // endpoint returns the whole set in one page, so the token is null.
        items: rows,
        count: rows.length,
        next_page_token: null,
      },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : rows.length === 0
          ? empty
          : [
              renderTable(COLUMNS, cells),
              "",
              `${rows.length} ${rows.length === 1 ? "variable" : "variables"}`,
            ].join("\n"),
    });
  }
}
