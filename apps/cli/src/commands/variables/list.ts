import { Flags } from "@oclif/core";

import { CommandGroups, OwnerCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderList } from "../../lib/oclif/crud/table";
import { listData } from "../../lib/oclif/envelope";
import { toVariableRows, variableCells } from "../../lib/variables";

/** The columns `list` renders, in order. */
const COLUMNS = ["name", "value"] as const;

/**
 * The `variables list` topic command — show the variables entered at the
 * project level.
 *
 * A secret is reported as held without its value, because the platform never
 * discloses one.
 */
export default class VariablesList extends OwnerCommand {
  static override description = "List the variables entered on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variables list --project-level",
    "<%= config.bin %> variables list --project-level --json",
  ];
  static override flags = {
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariablesList);
    await this.toMeta(flags);
    const { client, scope } = await this.connect();

    const rows = toVariableRows(await client.getVariables(scope));
    this.recordTelemetry({ variable_count: rows.length });

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header and nothing at all when
    // empty, so `cut`, `awk` and `wc -l` work on it; a terminal gets a table.
    const cells = variableCells(rows);
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: listData(rows),
      pretty: renderList(COLUMNS, cells, {
        plain,
        singular: "variable",
        empty: "No variables on the project.",
      }),
    });
  }
}
