import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../../lib/oclif";
import { liveDeployment } from "./requirements/live";
import { plainFlag, Tabulatable } from "../../../lib/oclif/tabulatable";
import { toVariableRows, variableCells } from "../../../lib/variables";

/** The columns `resolve` renders, in order. */
const COLUMNS = ["name", "value"] as const;

/**
 * `zitadel variable resolve` — show the variables a target actually runs.
 *
 * Not the store's current values but the map frozen onto the deployment that is
 * live on the target: what a later `variable set` has not reached. `--origin`
 * names one of the project's origins. Without it, resolving is unambiguous only
 * when a single deployment is live across the project; when several are — a
 * different release or frozen map on each origin — the live origins are named
 * and `--origin` is required rather than resolving from an arbitrary one
 * (#1617). A target with nothing deployed is a miss.
 */
export default class VariableResolve extends Tabulatable(EnvironmentCommand) {
  static override description = "Show the variables the live deployment froze for a target.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable resolve",
    "<%= config.bin %> variable resolve --origin https://app.acme.com",
    "<%= config.bin %> variable resolve --json",
  ];
  static override flags = {
    origin: Flags.string({ description: "The origin whose live deployment to read." }),
    plain: plainFlag,
  };

  static override requires = {
    live: liveDeployment,
  };

  protected async execute({
    flags,
    live,
  }: Admitted<typeof VariableResolve>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    // The live list narrows each deployment to the origins it still serves, so
    // this names exactly what the resolved map runs on — the chosen origin,
    // stated in the output.
    const servedOrigins = live.targets.map((target) => target.origin).sort();
    const where = servedOrigins.join(", ");

    const items = toVariableRows(
      await client.getDeploymentVariables(live.id, { project_id: projectId }),
    );
    this.recordTelemetry({ variable_count: items.length });

    const rows = variableCells(items);
    const columns = COLUMNS;
    const empty = `${live.id} froze no variables for ${where}.`;
    const footer = [`Frozen by ${live.id} for ${where}`];
    const page = null;
    const extra = {
      deployment_id: live.id,
      origins: servedOrigins,
    };

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
