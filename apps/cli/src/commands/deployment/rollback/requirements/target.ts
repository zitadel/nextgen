import { requirement } from "../../../../lib/oclif/requirements";
import type { History } from "./history";

/** The deployment a rollback re-applies, and the one it expects to be live. */
type Target = Readonly<{
  id: string;
  expectedDeploymentId: string | undefined;
}>;

/**
 * A named deployment is taken as given. A bare rollback decides from the one
 * read of the history, so its guard comes from that same read: a deploy landing
 * after it is one the caller never saw, and must make the server refuse rather
 * than become the expected one. With no deployment before the latest there is
 * nothing to roll back to, which is a refusal.
 */
function targetFrom(given: string | undefined, history: History): Target | undefined {
  if (given !== undefined) {
    return {
      id: given,
      expectedDeploymentId: undefined,
    };
  }
  if (history.latest === undefined || history.prior === undefined) {
    return undefined;
  }
  return {
    id: history.prior.id,
    expectedDeploymentId: history.latest.id,
  };
}

export const rollbackTarget = requirement<Target>({
  refusal: {
    message: "There is no earlier deployment to roll back to",
    hint: "Name a deployment to re-apply, or check `zitadel deployment list`.",
    next: ["deployment list"],
  },
  resolve: async ({ args, resolved }) =>
    targetFrom(args.deploymentId as string | undefined, resolved.history as History),
});
