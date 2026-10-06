import { Flags } from "@oclif/core";

import { liveDeployments, normalizeOrigin, shortTime, targetLabel } from "../../lib/deployments";
import { ZitadelError } from "../../lib/errors";
import { CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { toVariableRows, variableCells } from "../../lib/variables";
import { VarsCommand } from "../../lib/vars-command";

const COLUMNS = ["name", "serving_now"] as const;

/**
 * `zitadel vars resolve` — what a target is serving right now: the values
 * frozen onto its newest deployment, not what the store holds.
 */
export default class VarsResolve extends VarsCommand {
  static override description = "Show the variables a target is serving, frozen on its deployment.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> vars resolve",
    "<%= config.bin %> vars resolve --origin https://acme-git-sso-acmeinc.vercel.app",
  ];
  static override flags = {
    origin: Flags.string({
      description: "The target to read; omitted, the project default.",
    }),
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VarsResolve);
    await this.toMeta(flags);
    const { client, scope } = await this.connect();
    const origin = flags.origin ? normalizeOrigin(flags.origin) : "";
    const live = await liveDeployments(client, scope.project_id);
    const deployment = live.find((row) => row.origin === origin);
    if (!deployment) {
      throw new ZitadelError("E_NOT_FOUND", `nothing is deployed to ${targetLabel(origin)}`);
    }
    const rows = toVariableRows(await client.getDeploymentVariables(deployment.id, scope));
    this.recordTelemetry({ variable_count: rows.length });
    const cells = variableCells(rows).map((cell) => ({ name: cell.name, serving_now: cell.value }));
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { origin, deployment_id: deployment.id, deployed_at: deployment.deployed_at, variables: rows },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : [
            `serving ${deployment.id}   deployed ${shortTime(deployment.deployed_at)}`,
            "",
            rows.length === 0 ? "No variables frozen on this deployment." : renderTable(COLUMNS, cells),
          ].join("\n"),
    });
  }
}
