import { Flags } from "@oclif/core";

import { VariableService } from "../../lib/backend";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { plainFlag, Tabulatable } from "../../lib/oclif/tabulatable";

/** The columns `list` renders, in order; `--preview` leaves out the preview column. */
const COLUMNS = ["name", "value", "preview"] as const;
const PREVIEW_COLUMNS = ["name", "value"] as const;

/**
 * `zitadel variable list` — show the variables entered on the project.
 *
 * The project's own set. A secret is reported as held without its value, because
 * the platform never discloses one. Without `--preview` it lists every name with
 * its primary value and whether a preview value exists beside it (#1617); with
 * `--preview` it lists the preview values alone, which are never merged with the
 * primary ones — only the names that hold one.
 */
export default class VariableList extends Tabulatable(EnvironmentCommand) {
  static override description = "List the variables entered on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable list",
    "<%= config.bin %> variable list --preview",
    "<%= config.bin %> variable list --json",
  ];
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "List the preview values instead of the primary ones.",
    }),
    plain: plainFlag,
  };

  protected async execute({ flags }: Admitted<typeof VariableList>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const variableService = new VariableService(client, projectId);
    const items = await variableService.list(flags.preview ? "preview" : undefined);
    this.recordTelemetry({ variable_count: items.length });

    const rows = items.map((item) => (flags.preview ? item.cell() : item.inventoryCell()));
    const columns = flags.preview ? PREVIEW_COLUMNS : COLUMNS;
    const empty = flags.preview
      ? "No preview values on the project."
      : "No variables on the project.";
    const footer: string[] = [];
    const page = null;
    const extra = {};

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "variable",
      empty,
      footer,
      page,
      extra,
    });
  }
}
