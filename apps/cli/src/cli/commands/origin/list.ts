import { OriginService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { fieldsFlag, plainFlag } from "@/cli/core/tabulatable";
import { ReadCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** The columns `list` renders, in order. */
const COLUMNS = ["pattern", "kind"] as const;

/**
 * `zitadel origin list` — show the project's origin patterns.
 *
 * Origins are read off the project itself, not from `zitadel.json`: they are
 * project state, so the server is the authority. An empty list means every
 * origin is admitted until the first pattern is added.
 */
export default class OriginList extends Telemetered(ReadCommand) {
  static override description = "List the origin patterns on the project.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 3;

  static override examples = [
    "<%= config.bin %> origin list",
    "<%= config.bin %> origin list --plain",
  ];
  static override flags = {
    fields: fieldsFlag({
      fallback: ["pattern"],
      shape: {
        known: new Set(["pattern", "kind"]),
        open: [],
      },
    }),
    plain: plainFlag,
  };

  /**
   * Lists the origin patterns on the project.
   *
   * @param input - The flags the command accepts.
   * @returns The patterns, as a list.
   */
  protected async execute({ flags }: Admitted<typeof OriginList>): Promise<CommandResult> {
    const originService = await this.service(OriginService);
    const origins = await originService.list();

    const items = origins.all;
    const rows = items;
    const columns = COLUMNS;
    const empty = "No origins found";
    const footer: string[] = [];
    const page = null;
    const extra = {};

    return this.listed(flags, {
      columns,
      rows,
      items,
      singular: "origin",
      empty,
      footer,
      page,
      extra,
    });
  }
}
