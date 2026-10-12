import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";

/** The columns `list` renders, in order. */
const COLUMNS = ["id", "release_id", "reason", "origins", "deployed_at"] as const;

/**
 * `zitadel deployment list` — show the project's deployment history.
 *
 * Newest first: what went live where, and when. `--origin` narrows it to one
 * origin's history; `--live` shows what each target serves now instead of the
 * full history.
 */
export default class DeploymentList extends EnvironmentCommand {
  static override description = "List the project's deployments, newest first.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment list",
    "<%= config.bin %> deployment list --live",
    "<%= config.bin %> deployment list --origin https://app.acme.com",
  ];
  static override flags = {
    origin: Flags.string({ description: "Only deployments that targeted this origin." }),
    live: Flags.boolean({ description: "What each target serves now, not the full history." }),
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(DeploymentList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const { deployments } = await client.listDeployments({
      project_id: projectId,
      ...(flags.origin === undefined ? {} : { origin: flags.origin }),
      ...(flags.live ? { live: true } : {}),
    });

    // Flatten each deployment's targets to one `origins` cell for the table.
    const rows = deployments.map((deployment) => ({
      id: deployment.id,
      release_id: deployment.release_id,
      reason: deployment.metadata.reason ?? "deploy",
      origins: deployment.targets.map((target) => target.origin).join(", "),
      deployed_at: deployment.deployed_at,
    }));

    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { deployments, count: deployments.length },
      pretty: plain
        ? renderRows(COLUMNS, rows)
        : rows.length === 0
          ? "No deployments yet."
          : [
              renderTable(COLUMNS, rows),
              "",
              `${rows.length} ${rows.length === 1 ? "deployment" : "deployments"}`,
            ].join("\n"),
    });
  }
}
