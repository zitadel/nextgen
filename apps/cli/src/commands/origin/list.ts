import { Flags } from "@oclif/core";

import { connectEnvironment } from "../../lib/environment";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";

const COLUMNS = ["pattern", "kind"] as const;

/**
 * `zitadel origin list` — the origin patterns on the project. A pattern is
 * project state, changed deliberately with `add` and `rm` rather than as a
 * side effect of shipping; `deploy` only reads it.
 */
export default class OriginList extends BaseCommand {
  static override description = "List the project's origin patterns.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 8;
  static override examples = ["<%= config.bin %> origin list", "<%= config.bin %> origin list --json"];
  static override flags = {
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(OriginList);
    await this.toMeta(flags);
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    const project = await client.getProject(projectId);
    const rows = project.origins;
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { mode: project.mode, origins: rows, count: rows.length },
      pretty: plain
        ? renderRows(COLUMNS, rows)
        : rows.length === 0
          ? `No patterns; a ${project.mode} project with no origins serves every origin.`
          : renderTable(COLUMNS, rows),
    });
  }
}
