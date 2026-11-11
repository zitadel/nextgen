import { Args } from "@oclif/core";
import { z } from "zod";

import { DeploymentService, type Variable } from "@/lib/backend";
import { GetDeploymentVariablesParams } from "@/lib/backend/schemas";
import { Cmd } from "@/lib/cmd";
import { ZitadelError } from "@/lib/errors";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { type Refused, taken } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import { variableCell } from "@/lib/variables";

/**
 * The deployment `variable resolve` reads. The schema is the API spec's own, so
 * a value that is not one is refused before anything is called, and says what
 * one looks like.
 */
const DEPLOYMENT_ID: Refused<string> = {
  schema: z.string().trim().pipe(GetDeploymentVariablesParams.shape.deployment_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel deployment list`, or omit it to read the live deployment.",
    next: ["deployment list"],
    details: {
      argument: "{input}",
    },
  },
};

/** What naming both a deployment and an origin is refused for: the deployment already says which. */
const DEPLOYMENT_AND_ORIGIN_REFUSAL: Refusal = {
  message: "Name a deployment or an origin, not both.",
  hint: "A deployment id already says which deployment to read; `--origin` only picks the live one.",
};

/** The columns `resolve` renders, in order. */
const COLUMNS = ["name", "value"] as const;

/**
 * `zitadel variable resolve [DEPLOYMENT_ID]` — show the variables a deployment
 * actually runs.
 *
 * Not the store's current values but the map frozen onto a deployment: what a
 * later `variable set` has not reached. A deployment id names one, live or not,
 * as `deployment get` does, and `--origin` cannot accompany it.
 *
 * Without an id, the deployment live on the target is read. `--origin` names
 * one of the project's origins. Without it, resolving is unambiguous only when
 * a single deployment is live across the project; when several are — a
 * different release or frozen map on each origin — the live origins are named
 * and `--origin` is required rather than resolving from an arbitrary one.
 * A target with nothing deployed is a miss that says how to reach it:
 * `deploy` goes to every primary origin, including one added since the last
 * deploy, and a preview origin is only ever served by a pull-request build,
 * never by `deploy`.
 */
export default class VariableResolve extends Tabulatable(EnvironmentCommand) {
  static override description = "Show the variables a deployment froze, the live one by default.";
  static override group = CommandGroups.configuration;

  static override examples = [
    "<%= config.bin %> variable resolve",
    "<%= config.bin %> variable resolve --origin https://app.acme.com",
    "<%= config.bin %> variable resolve dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
    "<%= config.bin %> variable resolve --json",
  ];
  static override args = {
    deployment_id: Args.custom<string>({ parse: taken(DEPLOYMENT_ID) })({
      required: false,
      description: "The deployment to read; the live one when omitted.",
    }),
  };
  static override flags = {
    origin: nonBlankString({
      description: "The origin whose live deployment to read.",
    }),
    plain: plainFlag,
  };

  protected async execute({
    args,
    flags,
  }: Admitted<typeof VariableResolve>): Promise<JsonEnvelope> {
    if (args.deploymentId !== undefined && flags.origin !== undefined) {
      throw refusalError(DEPLOYMENT_AND_ORIGIN_REFUSAL, {});
    }
    const { client, projectId } = await this.connect();
    const deploymentService = new DeploymentService(client, projectId);
    if (args.deploymentId !== undefined) {
      const items = await deploymentService.variables(args.deploymentId);
      return this.render(flags, args.deploymentId, items, "", {});
    }
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
    const items = await deploymentService.variables(live.id);
    const origins = [...live.origins].sort();
    return this.render(flags, live.id, items, ` for ${origins.join(", ")}`, { origins });
  }

  /**
   * The list of what a deployment froze, as the run's one answer.
   *
   * @param flags - The run's flags, which choose the rendering.
   * @param deploymentId - The deployment the variables were frozen by.
   * @param items - The frozen variables.
   * @param where - The suffix naming the origins the deployment serves, or empty.
   * @param extra - The origins the envelope carries beside the deployment id, or none.
   * @returns The envelope to print.
   */
  private async render(
    flags: Admitted<typeof VariableResolve>["flags"],
    deploymentId: string,
    items: readonly Variable[],
    where: string,
    extra: { origins?: string[] },
  ): Promise<JsonEnvelope> {
    this.recordTelemetry({
      variable_count: items.length,
    });

    const rows = items.map((item) => {
      return variableCell(item);
    });
    const columns = COLUMNS;
    const empty = `${deploymentId} froze no variables${where}`;
    const footer = [`Frozen by ${deploymentId}${where}`];
    const page = null;
    const data = {
      deployment_id: deploymentId,
      ...extra,
    };

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "variable",
      empty,
      footer,
      page,
      extra: data,
    });
  }
}
