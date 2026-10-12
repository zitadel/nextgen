import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { ZitadelError } from "../../lib/errors";
import { toVariableRows, variableCells } from "../../lib/variables";

/** The columns `resolve` renders, in order. */
const COLUMNS = ["name", "value"] as const;

/**
 * `zitadel variable resolve` — show the variables a target actually runs.
 *
 * Not the store's current values but the map frozen onto the deployment that is
 * live on the target: what a later `variable set` has not reached. `--origin`
 * names one of the project's origins; without it the newest live deployment is
 * read, which is the default target a plain `deploy` serves. A target with
 * nothing deployed is a miss.
 */
export default class VariableResolve extends EnvironmentCommand {
  static override description = "Show the variables the live deployment froze for a target.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable resolve",
    "<%= config.bin %> variable resolve --origin https://app.acme.com",
    "<%= config.bin %> variable resolve --json",
  ];
  static override flags = {
    origin: Flags.string({ description: "The origin whose live deployment to read." }),
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariableResolve);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();
    const origin = flags.origin;

    // The live deployments the target serves, newest first. `--origin` narrows
    // it to one origin; without it the newest live deployment stands in for the
    // default target.
    const { deployments } = await client.listDeployments({
      project_id: projectId,
      live: true,
      ...(origin === undefined ? {} : { origin }),
    });
    const live = deployments[0];
    if (live === undefined) {
      const where = origin === undefined ? "the project" : origin;
      throw new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${where}.`, {
        hint: "Deploy first with `zitadel deploy`, then resolve its variables.",
        nextCommands: ["zitadel deploy"],
      });
    }

    const rows = toVariableRows(
      await client.getDeploymentVariables(live.id, { project_id: projectId }),
    );
    this.recordTelemetry({ variable_count: rows.length });

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header; a terminal gets a table.
    const cells = variableCells(rows);
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { deployment_id: live.id, variables: rows, count: rows.length },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : rows.length === 0
          ? `${live.id} froze no variables.`
          : [
              renderTable(COLUMNS, cells),
              "",
              `${rows.length} ${rows.length === 1 ? "variable" : "variables"} frozen by ${live.id}`,
            ].join("\n"),
    });
  }
}
