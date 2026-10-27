import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderList } from "../../lib/oclif/crud/table";
import { listData } from "../../lib/oclif/envelope";
import {
  toInventoryRows,
  toVariableRows,
  valuesOfKind,
  variableCells,
  variableInventoryCells,
  variableReadScope,
} from "../../lib/variables";

/** The columns `list` renders, in order; the inventory adds the preview kind. */
const COLUMNS = ["name", "value"] as const;
const INVENTORY_COLUMNS = ["name", "value", "preview"] as const;

/**
 * `zitadel variable list` — show the variables entered on the project.
 *
 * The project's own set. A secret is reported as held without its value, because
 * the platform never discloses one. Without `--preview` it lists every name with
 * its primary value and whether a preview value exists beside it (#1617); with
 * `--preview` it lists the preview values alone, which are never merged with the
 * primary ones — only the names that hold one.
 */
export default class VariableList extends EnvironmentCommand {
  static override description = "List the variables entered on the project.";
  static override group = CommandGroups.configuration;

  static override heading = "Listing variables";
  static override examples = [
    "<%= config.bin %> variable list",
    "<%= config.bin %> variable list --preview",
    "<%= config.bin %> variable list --json",
  ];
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "List the preview values instead of the primary ones.",
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
    const scope = variableReadScope(projectId, flags.preview);

    // The inventory reads both kinds, which a read without a kind answers in
    // one request; `--preview` reads that kind alone.
    const rows = flags.preview
      ? toVariableRows(valuesOfKind(await client.getVariables(scope), scope.kind))
      : toInventoryRows(await client.getVariables({ project_id: projectId }));
    this.recordTelemetry({ variable_count: rows.length });

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header and nothing at all when
    // empty, so `cut`, `awk` and `wc -l` work on it; a terminal gets a table.
    const cells = flags.preview ? variableCells(rows) : variableInventoryCells(rows);
    const plain = flags.plain || !process.stdout.isTTY;
    const empty = flags.preview
      ? "No preview values on the project."
      : "No variables on the project.";
    return this.emit({
      status: "ok",
      data: listData(rows),
      pretty: renderList(flags.preview ? COLUMNS : INVENTORY_COLUMNS, cells as never, {
        plain,
        singular: "variable",
        empty,
      }),
    });
  }
}
