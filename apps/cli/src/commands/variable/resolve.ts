import { type ZitadelClient, type Deployment, DeploymentService } from "../../lib/backend";
import { Cmd } from "../../lib/cmd";
import { ZitadelError } from "../../lib/errors";
import { DEPLOY_ARGS, type SuggestedCommand } from "../../lib/suggestion";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { plainFlag, Tabulatable } from "../../lib/oclif/tabulatable";

/**
 * The deployment live on the target. Without `--origin`, more than one live
 * deployment means there is no single frozen map to show, because each origin
 * may run a different one, so the live origins are named for the reader to pick
 * from (#1617). A target with nothing deployed is a miss that says how to reach
 * it: `deploy` goes to every primary origin, including one added since the last
 * deploy, and a preview origin is only ever served by a pull-request build,
 * never by `deploy`. The refusals are built here because their next commands are
 * one per origin, which a refusal template cannot list.
 */
export async function liveDeployment(
  client: ZitadelClient,
  projectId: string,
  origin: string | undefined,
  suggest: (command: string) => SuggestedCommand,
): Promise<Deployment> {
  const deploymentService = new DeploymentService(client, projectId);
  const live = await deploymentService.liveOn(origin);
  switch (live.outcome) {
    case "live":
      return live.deployment;
    case "ambiguous":
      throw new ZitadelError(
        "E_VALIDATION",
        "More than one deployment is live; name which origin to resolve with --origin.",
        {
          hint: `Live origins: ${live.origins.join(", ")}.`,
          nextCommands: live.origins.map((entry) => {
            return suggest(`variable resolve --origin ${Cmd.quote(entry)}`);
          }),
        },
      );
    case "nothing-deployed":
      switch (live.reason) {
        case "none":
          throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to the project.", {
            hint: `Deploy first with \`${suggest(DEPLOY_ARGS)}\`, then resolve its variables.`,
            nextCommands: [suggest(DEPLOY_ARGS)],
          });
        case "primary":
          throw new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
            hint: `Deploy to it first with \`${suggest(DEPLOY_ARGS)}\`, then resolve its variables.`,
            nextCommands: [suggest(DEPLOY_ARGS)],
          });
        case "preview":
          throw new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
            hint: "A preview URL is served by a pull-request build, not by `deploy`; resolve its variables once that build has deployed it.",
          });
        case "unknown-origin":
          throw new ZitadelError("E_NOT_FOUND", `${origin} is not an origin of the project.`, {
            hint: "Check the origin for a typo, or list the project's origins.",
            nextCommands: [suggest("origin list")],
          });
      }
  }
}

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
    origin: nonBlankString({
      description: "The origin whose live deployment to read.",
    }),
    plain: plainFlag,
  };

  protected async execute({ flags }: Admitted<typeof VariableResolve>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const live = await liveDeployment(client, projectId, flags.origin, (command) => {
      return this.suggest(command);
    });

    // The live list narrows each deployment to the origins it still serves, so
    // this names exactly what the resolved map runs on — the chosen origin,
    // stated in the output.
    const servedOrigins = [...live.origins].sort();
    const where = servedOrigins.join(", ");

    const deploymentService = new DeploymentService(client, projectId);
    const items = await deploymentService.variables(live.id);
    this.recordTelemetry({
      variable_count: items.length,
    });

    const rows = items.map((item) => {
      return item.cell();
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
