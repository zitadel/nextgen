import type { ZitadelClient } from "../../lib/api-client";
import { Cmd } from "../../lib/cmd";
import { ZitadelError } from "../../lib/errors";
import { DeploymentService, OriginService } from "../../lib/backend";
import { DEPLOY_ARGS, type SuggestedCommand } from "../../lib/suggestion";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { plainFlag, Tabulatable } from "../../lib/oclif/tabulatable";

/** A deployment that is live on the target now. */
type LiveDeployment = Awaited<ReturnType<ZitadelClient["listDeployments"]["all"]>>[number];

/**
 * The miss for an origin nothing is deployed to, with the fix that reaches it:
 * `deploy` goes to every primary origin, including one added since the last
 * deploy, and a preview origin is only ever served by a pull-request build,
 * never by `deploy`.
 */
async function nothingDeployed(
  client: ZitadelClient,
  projectId: string,
  origin: string | undefined,
  suggest: (command: string) => SuggestedCommand,
): Promise<ZitadelError> {
  if (origin === undefined) {
    return new ZitadelError("E_NOT_FOUND", "Nothing is deployed to the project.", {
      hint: `Deploy first with \`${suggest(DEPLOY_ARGS)}\`, then resolve its variables.`,
      nextCommands: [suggest(DEPLOY_ARGS)],
    });
  }
  const originService = new OriginService(client, projectId);
  const origins = await originService.list();
  if (origins.some((entry) => entry.kind === "primary" && entry.pattern === origin)) {
    return new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
      hint: `Deploy to it first with \`${suggest(DEPLOY_ARGS)}\`, then resolve its variables.`,
      nextCommands: [suggest(DEPLOY_ARGS)],
    });
  }
  if (
    origins.some(
      (entry) => entry.kind === "preview" && OriginService.matches(entry.pattern, origin),
    )
  ) {
    return new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
      hint: "A preview URL is served by a pull-request build, not by `deploy`; resolve its variables once that build has deployed it.",
    });
  }
  return new ZitadelError("E_NOT_FOUND", `${origin} is not an origin of the project.`, {
    hint: "Check the origin for a typo, or list the project's origins.",
    nextCommands: [suggest("origin list")],
  });
}

/**
 * The deployment live on the target. Without `--origin`, more than one live
 * deployment means there is no single frozen map to show, because each origin
 * may run a different one, so the live origins are named for the reader to pick
 * from (#1617). A target with nothing deployed is a miss that says how to reach
 * it. The refusals are built here because their next commands are one per
 * origin, which a refusal template cannot list.
 */
export async function liveDeployment(
  client: ZitadelClient,
  projectId: string,
  origin: string | undefined,
  suggest: (command: string) => SuggestedCommand,
): Promise<LiveDeployment> {
  const deploymentService = new DeploymentService(client, projectId);
  const deployments = await deploymentService.live(origin);
  if (origin === undefined && deployments.length > 1) {
    const origins = [
      ...new Set(deployments.flatMap((deployment) => deployment.targets.map((t) => t.origin))),
    ].sort();
    throw new ZitadelError(
      "E_VALIDATION",
      "More than one deployment is live; name which origin to resolve with --origin.",
      {
        hint: `Live origins: ${origins.join(", ")}.`,
        nextCommands: origins.map((entry) => {
          return suggest(`variable resolve --origin ${Cmd.quote(entry)}`);
        }),
      },
    );
  }
  const live = deployments[0];
  if (live === undefined) {
    throw await nothingDeployed(client, projectId, origin, suggest);
  }
  return live;
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
    origin: nonBlankString({ description: "The origin whose live deployment to read." }),
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
    const servedOrigins = live.targets.map((target) => target.origin).sort();
    const where = servedOrigins.join(", ");

    const deploymentService = new DeploymentService(client, projectId);
    const items = await deploymentService.frozenVariables(live.id);
    this.recordTelemetry({ variable_count: items.length });

    const rows = items.map((item) => item.cell());
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
