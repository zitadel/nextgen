import { Flags } from "@oclif/core";

import {
  type DeploymentRow,
  liveDeployments,
  relativeExpiry,
  shortTime,
  targetLabel,
} from "../lib/deployments";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { renderRows, renderTable } from "../lib/oclif/crud/table";
import { connectTarget } from "../lib/target";

const LOG_COLUMNS = ["deployed", "target", "release", "reason", "deploy"] as const;
const LIVE_COLUMNS = ["target", "serving", "deployed", "expires"] as const;

/**
 * `zitadel deployments` — the deployment log, newest first, or with `--live`
 * what every target serves right now. The one view that covers the default,
 * each primary hostname and each live preview URL the same way.
 */
export default class Deployments extends BaseCommand {
  static override description = "List the deployment log, or what every target serves with --live.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 6;
  static override examples = [
    "<%= config.bin %> deployments",
    "<%= config.bin %> deployments --live",
    "<%= config.bin %> deployments --origin https://app.acme.com",
    "<%= config.bin %> deployments --deploy dpl_01KB3F8N2P9S5WQY",
  ];
  static override flags = {
    live: Flags.boolean({ description: "The newest row per target: what each one serves." }),
    origin: Flags.string({ description: "One target's history. Use 'default' for the project default." }),
    deploy: Flags.string({ description: "The rows one deploy wrote." }),
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Deployments);
    await this.toMeta(flags);
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });

    const rows: DeploymentRow[] = flags.live
      ? await liveDeployments(client, projectId)
      : ((
          await client.listDeployments({
            project_id: projectId,
            ...(flags.origin !== undefined
              ? { origin: flags.origin === "default" ? "" : flags.origin }
              : {}),
            ...(flags.deploy ? { deploy_id: flags.deploy } : {}),
          })
        ).deployments as DeploymentRow[]);

    const cells = flags.live
      ? rows.map((row) => ({
          target: targetLabel(row.origin),
          serving: row.release_id,
          deployed: shortTime(row.deployed_at),
          expires: relativeExpiry(row.expires_at),
        }))
      : rows.map((row) => ({
          deployed: shortTime(row.deployed_at),
          target: targetLabel(row.origin),
          release: row.release_id,
          reason: row.metadata.reason ?? "deploy",
          deploy: row.deploy_id,
        }));
    const columns = flags.live ? LIVE_COLUMNS : LOG_COLUMNS;
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { deployments: rows, count: rows.length, live: flags.live },
      pretty: plain
        ? renderRows(columns, cells)
        : rows.length === 0
          ? "No deployments yet."
          : renderTable(columns, cells),
    });
  }
}
