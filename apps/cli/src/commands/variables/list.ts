import { Flags } from "@oclif/core";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { toVariableRows, variableCells } from "../../lib/variables";

/** The columns `list` renders, in order. */
const COLUMNS = ["name", "value"] as const;

/**
 * The `variables list` topic command — show the variables entered at one owner.
 *
 * Owners are separate, not a ladder: an environment does not see the project
 * level's variables, nor the project level an environment's (ADR 062 §4). A
 * secret is reported as held without its value, because the platform never
 * discloses one.
 */
export default class VariablesList extends EnvironmentCommand {
  static override description = "List the variables entered on an environment or the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variables list --environment prod",
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
    const { client, scope, environment } = await this.connect();

    const rows = toVariableRows(await client.getVariables(scope));
    this.recordTelemetry({
      variable_count: rows.length,
      is_environment_scoped: environment !== undefined,
    });

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header and nothing at all when
    // empty, so `cut`, `awk` and `wc -l` work on it; a terminal gets a table.
    const cells = variableCells(rows);
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: {
        environment: environment ?? null,
        variables: rows,
        count: rows.length,
      },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : rows.length === 0
          ? `No variables on ${ownerLabel(environment)}.`
          : [
              renderTable(COLUMNS, cells),
              "",
              `${rows.length} ${rows.length === 1 ? "variable" : "variables"}`,
            ].join("\n"),
    });
  }
}
