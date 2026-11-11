import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { OriginService } from "@/lib/backend";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";

/** The columns `list` renders, in order. */
const COLUMNS = ["pattern", "kind"] as const;

/**
 * `zitadel origin list` — show the project's origin patterns.
 *
 * Origins are read off the project itself, not from `zitadel.json`: they are
 * project state, so the server is the authority. An empty list means every
 * origin is admitted until the first pattern is added.
 */
export default class OriginList extends Tabulatable(EnvironmentCommand) {
  static override description = "List the origin patterns on the project.";
  static override group = CommandGroups.configuration;

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
    const footer: string[] = [];
    const page = null;
    const extra = {};

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "origin",
      empty: "No origins found",
      footer,
      page,
      extra,
    });
  }
}
