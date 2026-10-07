import { Flags } from "@oclif/core";

import {
  type Deployment,
  liveTargets,
  relativeExpiry,
  shortTime,
  targetLabel,
} from "../../lib/deployments";
import { connectEnvironment } from "../../lib/environment";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";

const LOG_COLUMNS = ["deployed", "targets", "release", "reason", "deployment"] as const;
const LIVE_COLUMNS = ["target", "serving", "deployed", "expires", "deployment"] as const;

/**
 * `zitadel deployment list` — the deployments, newest first, or with `--live`
 * what every target serves right now. The one view that covers the default,
 * each primary hostname and each live preview URL the same way.
 */
export default class DeploymentList extends BaseCommand {
  static override description = "List the deployments, or what every target serves with --live.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 6;
  static override examples = [
    "<%= config.bin %> deployment list",
    "<%= config.bin %> deployment list --live",
    "<%= config.bin %> deployment list --origin https://app.acme.com",
  ];
  static override flags = {
    live: Flags.boolean({ description: "What each target serves right now, one line per target." }),
    origin: Flags.string({ description: "The deployments that touched one target. Use 'default' for the project default." }),
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(DeploymentList);
    await this.toMeta(flags);
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    const plain = flags.plain || !process.stdout.isTTY;

    if (flags.live) {
      const rows = await liveTargets(client, projectId);
      const cells = rows.map((row) => ({
        target: targetLabel(row.origin),
        serving: row.release_id,
        deployed: shortTime(row.deployed_at),
        expires: relativeExpiry(row.expires_at),
        deployment: row.deployment_id,
      }));
      return this.emit({
        status: "ok",
        data: { targets: rows, count: rows.length, live: true },
        pretty: plain
          ? renderRows(LIVE_COLUMNS, cells)
          : rows.length === 0
            ? "Nothing is deployed yet."
            : renderTable(LIVE_COLUMNS, cells),
      });
    }

    const { deployments } = await client.listDeployments({
      project_id: projectId,
      ...(flags.origin !== undefined ? { origin: flags.origin === "default" ? "" : flags.origin } : {}),
    });
    const rows = deployments as Deployment[];
    const cells = rows.map((row) => ({
      deployed: shortTime(row.deployed_at),
      targets: row.targets.map((target) => targetLabel(target.origin)).join(", "),
      release: row.release_id,
      reason: row.metadata.reason ?? "deploy",
      deployment: row.id,
    }));
    return this.emit({
      status: "ok",
      data: { deployments: rows, count: rows.length, live: false },
      pretty: plain
        ? renderRows(LOG_COLUMNS, cells)
        : rows.length === 0
          ? "No deployments yet."
          : renderTable(LOG_COLUMNS, cells),
    });
  }
}
