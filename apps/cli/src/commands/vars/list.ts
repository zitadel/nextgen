import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { renderScalar, toVariableRows, type VariableRow } from "../../lib/variables";
import { VarsCommand } from "../../lib/vars-command";

/** The columns `list` renders, in order. */
const COLUMNS = ["name", "type", "all_deploys", "previews"] as const;

/**
 * `zitadel vars list` — one list, no owner to choose: every name with the
 * value all deploys get and, where one is set, the value previews get.
 */
export default class VarsList extends VarsCommand {
  static override description = "List the project's variables and secrets.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 9;
  static override examples = ["<%= config.bin %> vars list", "<%= config.bin %> vars list --json"];
  static override flags = {
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VarsList);
    await this.toMeta(flags);
    const { client, scope } = await this.connect();

    const all = toVariableRows(await client.getVariables({ ...scope, applies_to: "all" }));
    const previews = toVariableRows(
      await client.getVariables({ ...scope, applies_to: "preview" }),
    );
    const byName = new Map<string, { all?: VariableRow; preview?: VariableRow }>();
    for (const row of all) {
      byName.set(row.name, { all: row });
    }
    for (const row of previews) {
      byName.set(row.name, { ...byName.get(row.name), preview: row });
    }
    const rows = [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, pair]) => ({
        name,
        secret: Boolean(pair.all?.secret || pair.preview?.secret),
        ...(pair.all && !pair.all.secret ? { value: pair.all.value } : {}),
        ...(pair.preview && !pair.preview.secret ? { preview_value: pair.preview.value } : {}),
        has_preview: pair.preview !== undefined,
      }));
    this.recordTelemetry({ variable_count: rows.length });

    const cell = (row: VariableRow | undefined): string =>
      row === undefined ? "—" : row.secret ? "(secret)" : renderScalar(row.value);
    const cells = [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, pair]) => ({
        name,
        type: pair.all?.secret || pair.preview?.secret ? "secret" : "value",
        all_deploys: cell(pair.all),
        previews: cell(pair.preview),
      }));
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { variables: rows, count: rows.length },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : rows.length === 0
          ? "No variables on the project."
          : [
              renderTable(COLUMNS, cells),
              "",
              `${rows.length} ${rows.length === 1 ? "variable" : "variables"}`,
            ].join("\n"),
    });
  }
}
