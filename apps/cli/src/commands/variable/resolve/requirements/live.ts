import type { ZitadelClient } from "../../../../lib/api-client";
import { Cmd } from "../../../../lib/cmd";
import { ZitadelError } from "../../../../lib/errors";
import { requirement } from "../../../../lib/oclif/requirements";
import { DEPLOY_ARGS, originMatchesPattern } from "../../../../lib/release";
import type { SuggestedCommand } from "../../../../lib/suggestion";

/** A deployment that is live on the target now. */
export type LiveDeployment = Awaited<ReturnType<ZitadelClient["listDeployments"]["all"]>>[number];

/**
 * The miss for an origin nothing is deployed to, with the fix that reaches
 * it: `deploy` goes to every primary origin, including one added since the
 * last deploy, and a preview origin is only ever served by a
 * pull-request build, never by `deploy`.
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
  const project = await client.getProject(projectId);
  const origins = project.origins;
  if (origins.some((entry) => entry.kind === "primary" && entry.pattern === origin)) {
    return new ZitadelError("E_NOT_FOUND", `Nothing is deployed to ${origin}.`, {
      hint: `Deploy to it first with \`${suggest(DEPLOY_ARGS)}\`, then resolve its variables.`,
      nextCommands: [suggest(DEPLOY_ARGS)],
    });
  }
  if (
    origins.some((entry) => entry.kind === "preview" && originMatchesPattern(entry.pattern, origin))
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
export const liveDeployment = requirement<LiveDeployment>({
  resolve: async ({ flags, connect, suggest }) => {
    const { client, projectId } = await connect();
    const origin = typeof flags.origin === "string" ? flags.origin : undefined;
    const deployments = await client.listDeployments.all({
      project_id: projectId,
      live: true,
      origin,
    });
    if (origin === undefined && deployments.length > 1) {
      const origins = [
        ...new Set(deployments.flatMap((deployment) => deployment.targets.map((t) => t.origin))),
      ].sort();
      throw new ZitadelError(
        "E_VALIDATION",
        "More than one deployment is live; name which origin to resolve with --origin.",
        {
          hint: `Live origins: ${origins.join(", ")}.`,
          nextCommands: origins.map((o) => suggest(`variable resolve --origin ${Cmd.quote(o)}`)),
        },
      );
    }
    const live = deployments[0];
    if (live === undefined) {
      throw await nothingDeployed(client, projectId, origin, suggest);
    }
    return live;
  },
});
