import { OriginService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";
import { ServerCommand } from "@/cli/commands/server-command";
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
export default class OriginList extends Telemetered(
  Tabulatable(ServerCommand(EnvironmentCommand)),
) {
  static override description = "List the origin patterns on the project.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 3;

  static override examples = [
    "<%= config.bin %> origin list",
    "<%= config.bin %> origin list --plain",
  ];
  static override flags = {
    plain: plainFlag,
  };

  protected async execute({ flags }: Admitted<typeof OriginList>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const originService = new OriginService(client, projectId);
    const origins = await originService.list();

    const items = origins.all;
    const rows = items;
    const columns = COLUMNS;
    const empty = "No origins found";
    const footer: string[] = [];
    const page = null;
    const extra = {};

    return this.emitList(flags, {
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
