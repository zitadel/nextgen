import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { plainFlag, Tabulatable } from "../../lib/oclif/tabulatable";

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

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(OriginList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const project = await client.getProject(projectId);
    const origins = project.origins;

    return this.emitList(flags, {
      columns: COLUMNS,
      rows: origins,
      singular: "origin",
      empty: "No origins on the project.",
    });
  }
}
