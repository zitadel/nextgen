import { Args } from "@oclif/core";
import { z } from "zod";

import { DeploymentService, type Variable } from "@/lib/backend";
import { ListDeploymentVariablesParams } from "@/lib/backend/schemas";
import { ZitadelError } from "@/lib/errors";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { type Refused, taken } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { fieldsFlag, plainFlag } from "@/cli/core/tabulatable";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { VariableView } from "@/lib/variable";
import { ReadCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * The deployment `variable resolve` reads. The schema is the API spec's own, so
 * a value that is not one is refused before anything is called, and says what
 * one looks like.
 */
const DEPLOYMENT_ID: Refused<string> = {
  schema: z.string().trim().pipe(ListDeploymentVariablesParams.shape.deployment_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "List the deployments to find one, or omit it to read the live deployment.",
    next: [{ id: "deployment:list" }],
    details: {
      argument: "{input}",
    },
  },
};

/** What naming both a deployment and an origin is refused for: the deployment already says which. */
const DEPLOYMENT_AND_ORIGIN_REFUSAL = {
  message: "Name a deployment or an origin, not both.",
  hint: "A deployment id already says which deployment to read; `--origin` only picks the live one.",
} as const satisfies Refusal;

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
export default class VariableResolve extends Telemetered(ReadCommand) {
  static override description = "Show the variables a deployment froze, the live one by default.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> variable resolve",
    "<%= config.bin %> variable resolve --origin https://app.acme.com",
    "<%= config.bin %> variable resolve dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
    "<%= config.bin %> variable resolve --json",
  ];
  static override args = {
    deployment_id: Args.custom<string>({
      parse: taken(DEPLOYMENT_ID),
    })({
      required: false,
      description: "The deployment to read; the live one when omitted.",
    }),
  };
  static override flags = {
    origin: nonBlankString({
      description: "The origin whose live deployment to read.",
    }),
    fields: fieldsFlag({
      fallback: ["name"],
      shape: {
        known: new Set(["name", "secret", "value", "preview", "preview.secret", "preview.value"]),
        open: [],
      },
    }),
    plain: plainFlag,
  };

  /**
   * Shows the variables a named deployment froze, or the live one's.
   *
   * The ambiguous refusal is worded here, not from a template, because its next
   * commands are one per origin, which a refusal template cannot list. The live
   * list names every origin a deployment still serves, so the answer names
   * exactly what the resolved map runs on: all of the deployment's origins, the
   * one asked for among them.
   *
   * @param input - The arguments and flags the command accepts.
   * @returns The envelope of the run.
   * @throws {ZitadelError} When the deployment and origin are both given, or nothing live matches.
   */
  protected async execute({
    args,
    flags,
  }: Admitted<typeof VariableResolve>): Promise<CommandResult> {
    if (args.deploymentId !== undefined && flags.origin !== undefined) {
      throw refusalError(DEPLOYMENT_AND_ORIGIN_REFUSAL, {});
    }
    const deploymentService = await this.service(DeploymentService);
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
        throw new ZitadelError(
          "E_VALIDATION",
          "More than one deployment is live; name which origin to resolve with --origin.",
          {
            hint: `Live origins: ${found.origins.join(", ")}.`,
            nextCommands: found.origins.map((entry) => {
              return this.suggest({
                id: "variable:resolve",
                flags: { origin: entry },
              });
            }),
          },
        );
      }
      case "nothing-deployed": {
        switch (found.reason) {
          case "none": {
            throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to the project.", {
              hint: "Deploy first, then resolve its variables.",
              nextCommands: [
                this.suggest({
                  id: "deploy",
                  flags: { message: WHAT_CHANGED },
                }),
              ],
            });
          }
          case "primary": {
            throw new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${flags.origin}.`, {
              hint: "Deploy to it first, then resolve its variables.",
              nextCommands: [
                this.suggest({
                  id: "deploy",
                  flags: { message: WHAT_CHANGED },
                }),
              ],
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
                nextCommands: [this.suggest({ id: "origin:list" })],
              },
            );
          }
        }
      }
    }

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
   * @param carried - The origins the envelope carries beside the deployment id, or none.
   * @returns The envelope to print.
   */
  private async render(
    flags: Admitted<typeof VariableResolve>["flags"],
    deploymentId: string,
    items: readonly Variable[],
    where: string,
    carried: { origins?: string[] },
  ): Promise<CommandResult> {
    this.annotate({
      variable_count: items.length,
    });

    const rows = items.map((item) => {
      return VariableView.of(item).cell();
    });
    const columns = COLUMNS;
    const empty = `${deploymentId} froze no variables${where}`;
    const footer = [`Frozen by ${deploymentId}${where}`];
    const page = null;
    const extra = {
      deployment_id: deploymentId,
      ...carried,
    };

    return this.listed(flags, {
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
