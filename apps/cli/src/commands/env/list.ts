import { readBoundEnvironments } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { plainFlag, Tabulatable } from "../../lib/oclif/tabulatable";

/** The columns `list` renders, in order. */
const COLUMNS = ["name", "source", "server", "project_id", "resolved"] as const;

/**
 * `zitadel env list` — the environments this machine can reach: one per
 * `.env.<name>.local` that holds a project id, plus the process environment
 * when it carries one. An environment that lives only in a CI secret store is
 * not visible here, which is correct.
 */
export default class EnvList extends Tabulatable(EnvironmentCommand) {
  static override description = "List the environments bound in this directory's .env files.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> env list", "<%= config.bin %> env list --plain"];
  static override flags = {
    plain: plainFlag,
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(EnvList);
    const { cwd, env } = await this.toMeta(flags);
    const { name, values } = this.environment;

    const bound = await readBoundEnvironments(cwd);
    const items = [
      ...bound.map((entry) => ({
        name: entry.name,
        source: entry.file,
        server: entry.values.ZITADEL_URL ?? "",
        project_id: entry.values.ZITADEL_PROJECT_ID ?? "",
      })),
      ...(env.ZITADEL_PROJECT_ID
        ? [
            {
              name: name.value,
              source: "process environment",
              server: env.ZITADEL_URL ?? "",
              project_id: env.ZITADEL_PROJECT_ID,
            },
          ]
        : []),
    ].map((entry) => ({
      ...entry,
      resolved: entry.source === values.ZITADEL_PROJECT_ID?.source,
    }));

    return this.emitList(flags, {
      columns: COLUMNS,
      rows: items.map((entry) => ({
        ...entry,
        resolved: entry.resolved ? "yes" : "",
      })),
      items,
      singular: "environment",
      empty: "No environments are bound here. Run `zitadel env add <name>` to bind one.",
      footer: [`Resolved now: ${name.value} (from ${name.source})`],
      extra: {
        resolved: {
          name: name.value,
          source: name.source,
        },
      },
    });
  }
}
