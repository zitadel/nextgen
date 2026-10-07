import { Flags } from "@oclif/core";

import { liveTargets, normalizeOrigin, shortTime, targetLabel } from "../../lib/deployments";
import { ZitadelError } from "../../lib/errors";
import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { toVariableRows, variableCells } from "../../lib/variables";
import { VariableCommand } from "../../lib/variable-command";

const COLUMNS = ["name", "serving_now"] as const;

/**
 * `zitadel variable resolve` — what a target is serving right now: the values
 * frozen onto its newest deployment, not what the store holds.
 */
export default class VariableResolve extends VariableCommand {
  static override description = "Show the variables a target is serving, frozen on its deployment.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable resolve",
    "<%= config.bin %> variable resolve --origin https://acme-git-sso-acmeinc.vercel.app",
  ];
  static override flags = {
    origin: Flags.string({
      description: "The target to read; omitted, the project default.",
    }),
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariableResolve);
    await this.toMeta(flags);
    const { client, scope } = await this.connect();
    const origin = flags.origin ? normalizeOrigin(flags.origin) : "";
    const live = await liveTargets(client, scope.project_id);
    const serving = live.find((row) => row.origin === origin);
    if (!serving) {
      throw new ZitadelError("E_NOT_FOUND", `nothing is deployed to ${targetLabel(origin)}`);
    }
    const rows = toVariableRows(await client.getDeploymentVariables(serving.deployment_id, scope));
    this.recordTelemetry({ variable_count: rows.length });
    const cells = variableCells(rows).map((cell) => ({ name: cell.name, serving_now: cell.value }));
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { origin, deployment_id: serving.deployment_id, deployed_at: serving.deployed_at, variables: rows },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : [
            `serving ${serving.deployment_id}   deployed ${shortTime(serving.deployed_at)}`,
            "",
            rows.length === 0 ? "No variables frozen on this deployment." : renderTable(COLUMNS, cells),
          ].join("\n"),
    });
  }
}
