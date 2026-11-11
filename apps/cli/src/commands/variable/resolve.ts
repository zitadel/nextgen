import { DeploymentService } from "@/lib/backend";
import { Cmd } from "@/lib/cmd";
import { ZitadelError } from "@/lib/errors";
import { DEPLOY_ARGS } from "@/lib/suggestion";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";
import { variableCell } from "@/lib/variables";

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
 * (#1617). A target with nothing deployed is a miss that says how to reach it:
 * `deploy` goes to every primary origin, including one added since the last
 * deploy, and a preview origin is only ever served by a pull-request build,
 * never by `deploy`.
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
    origin: nonBlankString({
      description: "The origin whose live deployment to read.",
    }),
    plain: plainFlag,
  };

  protected async execute({ flags }: Admitted<typeof VariableResolve>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const deploymentService = new DeploymentService(client, projectId);
    const found = await deploymentService.liveOn(flags.origin);
    switch (found.outcome) {
      case "live": {
        break;
      }
      case "ambiguous": {
        // The refusal is worded here because its next commands are one per
        // origin, which a refusal template cannot list.
        throw new ZitadelError(
          "E_VALIDATION",
          "More than one deployment is live; name which origin to resolve with --origin.",
          {
            hint: `Live origins: ${found.origins.join(", ")}.`,
            nextCommands: found.origins.map((entry) => {
              return this.suggest(`variable resolve --origin ${Cmd.quote(entry)}`);
            }),
          },
        );
      }
      case "nothing-deployed": {
        switch (found.reason) {
          case "none": {
            throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to the project.", {
              hint: "Deploy first, then resolve its variables.",
              nextCommands: [this.suggest(DEPLOY_ARGS)],
            });
          }
          case "primary": {
            throw new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${flags.origin}.`, {
              hint: "Deploy to it first, then resolve its variables.",
              nextCommands: [this.suggest(DEPLOY_ARGS)],
            });
          }
          case "preview": {
            throw new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${flags.origin}.`, {
              hint: "A preview URL is served by a pull-request build, not by a deploy from here; resolve its variables once that build has deployed it.",
            });
          }
          case "unknown-origin": {
            throw new ZitadelError(
              "E_NOT_FOUND",
              `${flags.origin} is not an origin of the project.`,
              {
                hint: "Check the origin for a typo, or list the project's origins.",
                nextCommands: [this.suggest("origin list")],
              },
            );
          }
        }
      }
    }

    // The live list narrows each deployment to the origins it still serves, so
    // this names exactly what the resolved map runs on — the chosen origin,
    // stated in the output.
    const live = found.deployment;
    const servedOrigins = [...live.origins].sort();
    const where = servedOrigins.join(", ");
    const items = await deploymentService.variables(live.id);
    this.recordTelemetry({
      variable_count: items.length,
    });

    const rows = items.map((item) => {
      return variableCell(item);
    });
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
