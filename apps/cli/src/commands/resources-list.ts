import { Flags } from "@oclif/core";

import { type Admitted, BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { Tabulatable } from "../lib/oclif/tabulatable";
import { describeRegistry } from "../lib/oclif/crud";
import { listData } from "../lib/oclif/envelope";
import { CommandGroups } from "../lib/oclif/groups";
import { RESOURCES } from "./resources";

/** The columns `resources` renders, in order. */
const COLUMNS = ["topic", "verbs", "filters"] as const;

/**
 * `zitadel resources` — what the resource surface exposes, in one call.
 *
 * An agent's first questions are "which resources exist, what can I do to
 * each, what can I filter on, and what does a body need". Answering those from
 * `--help` means one invocation per topic and parsing prose; this answers all
 * of them from the registry at once, and `--json` makes it machine-readable.
 * The command talks to no server: it describes the CLI, not the project.
 */
export default class ResourcesList extends Tabulatable(BaseCommand) {
  static override id = "resources";
  static override group = CommandGroups.diagnostics;
  static override description =
    "List the resources this CLI manages.\n\nShows what can be done to each.";
  static override examples = [
    "<%= config.bin %> resources",
    "<%= config.bin %> resources --json",
    '<%= config.bin %> resources --json | jq -r \'.data.items[] | "\\(.topic): \\(.verbs | join(", "))"\'',
  ];
  static override flags = {
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof ResourcesList>): Promise<JsonEnvelope> {
    const resources = describeRegistry(RESOURCES);

    const rows = resources.map((resource) => ({
      topic: String(resource.topic),
      verbs: (resource.verbs as string[]).join(", "),
      // Every list shares one filter grammar now, so the column is simply the
      // fields `--filter` accepts. What each field accepts beyond that — its
      // operations, its closed values — is in `--json` and in `--help`, which
      // is where a reader goes once they know the field exists.
      filters: ((resource.filters as Array<{ field: string }> | undefined) ?? [])
        .map((filter) => filter.field)
        .join(", "),
    }));

    const plain = this.isPlain(flags.plain);
    return this.emit({
      status: "ok",
      data: listData(resources),
      pretty: await this.tabulateList(COLUMNS, rows, {
        plain,
        singular: "resource",
        empty: "No resources.",
        footer: [`Run \`${this.config.bin} <resource> <verb> --help\` for a command's flags.`],
      }),
    });
  }
}
