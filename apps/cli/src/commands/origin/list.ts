import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { Tabulatable } from "../../lib/oclif/tabulatable";
import { listData } from "../../lib/oclif/envelope";

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
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof OriginList>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const project = await client.getProject(projectId);
    const origins = project.origins;

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header and nothing at all when
    // empty, so `cut`, `awk` and `wc -l` work on it; a terminal gets a table.
    const plain = this.isPlain(flags.plain);
    return this.emit({
      status: "ok",
      // The project returns its whole origin set in one page, so the token is null.
      data: listData(origins),
      pretty: await this.tabulateList(COLUMNS, origins, {
        plain,
        singular: "origin",
        empty: "No origins on the project.",
      }),
    });
  }
}
