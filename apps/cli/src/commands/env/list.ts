import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { renderTable } from "../../lib/oclif/crud/table";
import { detectEnvironment, listLocalEnvironments } from "../../lib/target";

const COLUMNS = ["environment", "server", "project"] as const;

/**
 * `zitadel env list` — the environments this machine can reach: one per
 * `.env.<name>.local` carrying a project id, plus whatever the process
 * environment supplies. An environment that exists only in a CI secret store
 * is invisible here, which is correct.
 */
export default class EnvList extends BaseCommand {
  static override description = "List the environments bound in this directory's .env files.";
  static override group = CommandGroups.project;
  static override examples = ["<%= config.bin %> env list"];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(EnvList);
    await this.toMeta(flags, { resolveServer: false });
    const { cwd, env } = this.meta;
    const found = await listLocalEnvironments(cwd);
    const rows = found.map((entry) => ({
      environment: entry.name,
      file: entry.file,
      server: entry.values.ZITADEL_URL ?? "",
      project: entry.values.ZITADEL_PROJECT_ID ?? "",
    }));
    if (env.ZITADEL_PROJECT_ID) {
      rows.push({
        environment: detectEnvironment(env).value,
        file: "process env",
        server: env.ZITADEL_URL ?? "",
        project: env.ZITADEL_PROJECT_ID,
      });
    }
    const current = detectEnvironment(env);
    return this.emit({
      status: "ok",
      data: { environments: rows, resolved: current },
      pretty:
        rows.length === 0
          ? "No environments bound here. Run `zitadel env add <name>`."
          : [
              renderTable(COLUMNS, rows),
              "",
              `resolved now  ${current.value}   (${current.source})`,
            ].join("\n"),
    });
  }
}
