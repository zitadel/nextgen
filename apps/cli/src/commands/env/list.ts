import { readBoundEnvironments } from "@/lib/environment";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { nothingFound, plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";

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

  protected async execute({ flags }: Admitted<typeof EnvList>): Promise<JsonEnvelope> {
    const { name, values } = this.environment;

    const bound = await readBoundEnvironments(this.cwd);
    const items = [
      ...bound.map((entry) => ({
        name: entry.name,
        source: entry.file,
        server: entry.values.ZITADEL_URL ?? "",
        project_id: entry.values.ZITADEL_PROJECT_ID ?? "",
      })),
      ...(this.env.ZITADEL_PROJECT_ID
        ? [
            {
              name: name.value,
              source: "process environment",
              server: this.env.ZITADEL_URL ?? "",
              project_id: this.env.ZITADEL_PROJECT_ID,
            },
          ]
        : []),
    ].map((entry) => ({
      ...entry,
      resolved: entry.source === values.ZITADEL_PROJECT_ID?.source,
    }));

    const rows = items.map((entry) => ({
      ...entry,
      resolved: entry.resolved ? "yes" : "",
    }));
    const columns = COLUMNS;
    const empty = nothingFound("environments");
    const footer = [`Resolved now: ${name.value} (from ${name.source})`];
    const page = null;
    const extra = {
      resolved: {
        name: name.value,
        source: name.source,
      },
    };

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "environment",
      empty,
      footer,
      page,
      extra,
    });
  }
}
