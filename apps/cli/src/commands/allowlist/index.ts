import { Flags } from "@oclif/core";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { connectTarget } from "../../lib/target";

const COLUMNS = ["pattern", "kind"] as const;

/**
 * `zitadel allowlist` — the origin patterns on the project. A pattern is
 * project state, changed deliberately with `add` and `rm` rather than as a
 * side effect of shipping; `deploy` only reads it.
 */
export default class Allowlist extends BaseCommand {
  static override description = "List the project's allowed origin patterns.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 8;
  static override examples = ["<%= config.bin %> allowlist", "<%= config.bin %> allowlist --json"];
  static override flags = {
    plain: Flags.boolean({ description: "Tab-separated rows with no header, for piping." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Allowlist);
    await this.toMeta(flags);
    const { cwd, env, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    const project = await client.getProject(projectId);
    const rows = project.allowed_origins;
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { class: project.class, allowed_origins: rows, count: rows.length },
      pretty: plain
        ? renderRows(COLUMNS, rows)
        : rows.length === 0
          ? `No patterns; a ${project.class} project with an empty allowlist serves every origin.`
          : renderTable(COLUMNS, rows),
    });
  }
}
