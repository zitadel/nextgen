import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { describeRegistry, observedPaths } from "@/cli/core/crud";
import { fieldsFlag, plainFlag } from "@/cli/core/tabulatable";

import { RESOURCES } from "./resources";
import { ServerCommand } from "@/cli/commands/server-command";
import { Tabulatable } from "@/cli/core/tabulatable";
import { BaseCommand } from "@/cli/core";
import { Telemetered } from "@/cli/telemetry/telemetered";

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
export default class ResourcesList extends Telemetered(Tabulatable(ServerCommand(BaseCommand))) {
  static override id = "resources";
  static override description =
    "List the resources this CLI manages.\n\nShows what can be done to each.";
  static override group = CommandGroups.apiAndEvents;
  static override groupOrder = 3;

  static override examples = [
    "<%= config.bin %> resources",
    "<%= config.bin %> resources --json",
    '<%= config.bin %> resources --json | jq -r \'.data.items[] | "\\(.topic): \\(.verbs | join(", "))"\'',
  ];
  static override flags = {
    fields: fieldsFlag({
      fallback: ["topic"],
      shape: observedPaths(describeRegistry(RESOURCES)),
    }),
    plain: plainFlag,
  };

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  /**
   * Lists every resource topic with its verbs and filters. Every list shares one
   * filter grammar, so the filters column is simply the fields `--filter`
   * accepts. What each field accepts beyond that, its operations and its closed
   * values, is in `--json` and in `--help`, which is where a reader goes once
   * they know the field exists.
   *
   * @param context - The admitted run, with its parsed flags.
   * @returns The listing.
   */
  protected async execute({ flags }: Admitted<typeof ResourcesList>): Promise<CommandResult> {
    const items = describeRegistry(RESOURCES);

    const rows = items.map((resource) => {
      return {
        topic: String(resource.topic),
        verbs: (resource.verbs as string[]).join(", "),
        filters: ((resource.filters as Array<{ field: string }> | undefined) ?? [])
          .map((filter) => {
            return filter.field;
          })
          .join(", "),
      };
    });

    const columns = COLUMNS;
    const empty = "No resources found";
    const footer = ["Add --help to any command for its flags."];
    const page = null;
    const extra = {};

    return this.listed(flags, {
      columns,
      rows,
      items,
      singular: "resource",
      empty,
      footer,
      page,
      extra,
    });
  }
}
