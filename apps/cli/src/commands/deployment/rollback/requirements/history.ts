import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";

import { requirement } from "../../../../lib/oclif/requirements";
import { servesPrimary } from "../../../../lib/release";

type Deployment = ListDeployments200DeploymentsItem;

/** The newest primary deployment and the one before it, either of which may not exist. */
export type History = Readonly<{
  latest: Deployment | undefined;
  prior: Deployment | undefined;
}>;

/**
 * The primary deployments a bare rollback decides from. A preview deployment is
 * never the one a bare rollback undoes, nor one it can restore. Naming a
 * deployment needs none of it, and reads nothing. Nothing deployed is a
 * refusal, since there is nothing to undo.
 */
async function primaryHistory(
  given: string | undefined,
  load: () => Promise<readonly Deployment[]>,
): Promise<History | undefined> {
  if (given !== undefined) {
    return {
      latest: undefined,
      prior: undefined,
    };
  }
  const [latest, prior] = (await load()).filter(servesPrimary);
  if (latest === undefined) {
    return undefined;
  }
  return {
    latest,
    prior,
  };
}

/**
 * The whole history is read, not the first page, because the prior deployment
 * of a long-lived origin can sit beyond it, and a bare rollback that missed it
 * would refuse a rollback it should resolve.
 */
export const deploymentHistory = requirement<History>({
  refusal: {
    message: "There is no deployment to roll back",
    hint: "Nothing has been deployed yet; check `zitadel deployment list`.",
    next: ["deployment list"],
  },
  resolve: ({ args, connect }) =>
    primaryHistory(args.deploymentId as string | undefined, async () => {
      const { client, projectId } = await connect();
      return client.listDeployments.all({ project_id: projectId });
    }),
});
