import { Flags } from "@oclif/core";
import type { ZitadelClient } from "../../lib/api-client";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { listData } from "../../lib/oclif/envelope";
import { DEPLOY_ARGS, listLiveDeployments, originMatchesPattern } from "../../lib/release";
import { ZitadelError } from "../../lib/errors";
import { shellArg } from "../../lib/shell";
import { toVariableRows, variableCells } from "../../lib/variables";

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
export default class VariableResolve extends EnvironmentCommand {
  static override description = "Show the variables the live deployment froze for a target.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable resolve",
    "<%= config.bin %> variable resolve --origin https://app.acme.com",
    "<%= config.bin %> variable resolve --json",
  ];
  static override flags = {
    origin: Flags.string({ description: "The origin whose live deployment to read." }),
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariableResolve);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();
    const origin = flags.origin;

    // Every deployment live on the target now, newest first. `--origin` narrows
    // the read to one origin; without it the whole project's live set comes
    // back, so an ambiguous project can be named rather than resolved from an
    // arbitrary deployment.
    // Drained across pages, so a project with many live previews still names
    // every origin, primaries included.
    const deployments = await listLiveDeployments(
      client,
      projectId,
      origin === undefined ? {} : { origin },
    );

    // Without `--origin`, more than one live deployment means there is no single
    // frozen map to show: each origin may run a different one. The live origins
    // are named so the reader can pick one, rather than silently reading the
    // first (#1617).
    if (origin === undefined && deployments.length > 1) {
      const origins = [
        ...new Set(deployments.flatMap((deployment) => deployment.targets.map((t) => t.origin))),
      ].sort();
      throw new ZitadelError(
        "E_VALIDATION",
        "More than one deployment is live; name which origin to resolve with --origin.",
        {
          hint: `Live origins: ${origins.join(", ")}.`,
          nextCommands: origins.map((o) =>
            this.suggest(`variable resolve --origin ${shellArg(o)}`),
          ),
        },
      );
    }

    const live = deployments[0];
    if (live === undefined) {
      throw await this.nothingDeployed(client, projectId, origin);
    }
    // The live list narrows each deployment to the origins it still serves, so
    // this names exactly what the resolved map runs on — the chosen origin,
    // stated in the output.
    const servedOrigins = live.targets.map((target) => target.origin).sort();
    const where = servedOrigins.join(", ");

    const rows = toVariableRows(
      await client.getDeploymentVariables(live.id, { project_id: projectId }),
    );
    this.recordTelemetry({ variable_count: rows.length });

    // The resource commands' list rendering: a pipe (or `--plain`) gets one
    // tab-separated record per line, with no header; a terminal gets a table.
    const cells = variableCells(rows);
    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: { deployment_id: live.id, origins: servedOrigins, ...listData(rows) },
      pretty: plain
        ? renderRows(COLUMNS, cells)
        : rows.length === 0
          ? `${live.id} froze no variables for ${where}.`
          : [
              renderTable(COLUMNS, cells),
              "",
              `${rows.length} ${rows.length === 1 ? "variable" : "variables"} frozen by ${live.id} for ${where}`,
            ].join("\n"),
    });
  }

  /**
   * The miss for an origin nothing is deployed to, with the fix that reaches
   * it: `deploy` goes to every primary origin, including one added since the
   * last deploy, and a preview origin is only ever served by a
   * pull-request build, never by `deploy`.
   */
  private async nothingDeployed(
    client: ZitadelClient,
    projectId: string,
    origin: string | undefined,
  ): Promise<ZitadelError> {
    if (origin === undefined) {
      return new ZitadelError("E_NOT_FOUND", "Nothing is deployed to the project.", {
        hint: `Deploy first with \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`, then resolve its variables.`,
        nextCommands: [this.suggest(DEPLOY_ARGS)],
      });
    }
    const origins = (await client.getProject(projectId)).origins ?? [];
    if (origins.some((entry) => entry.kind === "primary" && entry.pattern === origin)) {
      return new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
        hint: `Deploy to it first with \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`, then resolve its variables.`,
        nextCommands: [this.suggest(DEPLOY_ARGS)],
      });
    }
    if (
      origins.some(
        (entry) => entry.kind === "preview" && originMatchesPattern(entry.pattern, origin),
      )
    ) {
      return new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
        hint: "A preview URL is served by a pull-request build, not by `deploy`; resolve its variables once that build has deployed it.",
      });
    }
    return new ZitadelError("E_NOT_FOUND", `${origin} is not an origin of the project.`, {
      hint: "Check the origin for a typo, or list the project's origins.",
      nextCommands: [this.suggest("origin list")],
    });
  }
}
