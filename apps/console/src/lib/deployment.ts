import type {
  ListDeployments200DeploymentsItem,
  ListDeploymentsParams,
} from "@zitadel/api/generated/model";

import { api } from "@/api/zitadel";

/**
 * Reads behind the deployment screens.
 *
 * A deployment is an append-only record of a release going live on a set of
 * origins. The record says what kind of origins it went to and whether any of
 * them still serves it, so the screens show both as the server reports them.
 */

/** One entry of `GET /deployments`. */
export type Deployment = ListDeployments200DeploymentsItem;

/** What the screens call each kind. */
export const KIND_LABEL: Record<Deployment["kind"], string> = {
  primary: "Primary",
  preview: "Preview",
};

/** The most `GET /deployments` hands back per page. */
const PAGE_SIZE = 100;

/**
 * Each deployment carries its release, so a screen knows whether the release
 * can still be deployed without a read per row.
 */
const EXPAND_RELEASE: ListDeploymentsParams["expand"] = ["release"];

/** Whether the deployment's release is revoked; false when the release is not embedded. */
export function releaseRevoked(deployment: Deployment): boolean {
  return deployment.release?.revoked_at != null;
}

/**
 * Where a release went, newest first. `GET /deployments` has no filter by
 * release, so the project's whole history is read and filtered here; a
 * release's own history is a handful.
 */
export async function listReleaseDeployments(
  projectId: string,
  releaseId: string,
): Promise<Deployment[]> {
  const history = await api.listDeployments.all({ project_id: projectId, limit: PAGE_SIZE });
  return history.filter((deployment) => deployment.release_id === releaseId);
}

/** How many rows the directory shows per `Load more` (D5). */
const TABLE_PAGE_SIZE = 25;

/** One page of the project's deployments, newest first. */
export interface DeploymentPage {
  items: Deployment[];
  nextPageToken?: string;
}

export async function listProjectDeployments(
  projectId: string,
  pageToken?: string,
): Promise<DeploymentPage> {
  const page = await api.listDeployments({
    project_id: projectId,
    expand: EXPAND_RELEASE,
    limit: TABLE_PAGE_SIZE,
    page_token: pageToken,
  });
  return { items: page.deployments, nextPageToken: page.next_page_token ?? undefined };
}

/** The target `POST /deployments` resolves to every primary origin of the project. */
const PRIMARY_TARGET = "primary";

/** The project's primary origins, in the order the project lists them. */
export async function listPrimaryOrigins(projectId: string): Promise<string[]> {
  const project = await api.getProject(projectId);
  return project.origins
    .filter((origin) => origin.kind === "primary")
    .map((origin) => origin.pattern);
}

/**
 * The deployment the primary origins serve now, if any: the one a deploy
 * replaces, and the one the server answers with when a deploy changes
 * nothing.
 */
export async function livePrimaryDeployment(projectId: string): Promise<Deployment | undefined> {
  const live = await api.listDeployments.all({
    project_id: projectId,
    live: true,
    limit: PAGE_SIZE,
  });
  return live.find((deployment) => deployment.kind === "primary" && deployment.status === "live");
}

/** The release the primary origins serve now, if any. */
export async function livePrimaryReleaseId(projectId: string): Promise<string | undefined> {
  return (await livePrimaryDeployment(projectId))?.release_id;
}

/**
 * Makes a release live on every primary origin, with the message on the
 * record. `expectedDeploymentId` is the deployment the operator saw as live:
 * the server refuses when another has landed since, rather than deploying
 * over it. When the origins already serve the release with the same values
 * the server writes nothing and answers with the deployment that is live.
 */
export function deployToPrimary(
  projectId: string,
  releaseId: string,
  input: { message?: string; expectedDeploymentId?: string },
) {
  return api.createDeployment(
    {
      release_id: releaseId,
      targets: [PRIMARY_TARGET],
      ...(input.message ? { message: input.message } : {}),
      ...(input.expectedDeploymentId ? { expected_deployment_id: input.expectedDeploymentId } : {}),
    },
    { project_id: projectId },
  );
}

/**
 * What the Rollback drawer offers: the primary deployment that is live, and
 * the superseded primary deployments it can go back to, newest first. A
 * deployment of the live release is left out, since rolling back to it
 * changes nothing; so is one of a revoked release, which the server refuses.
 * Previews are not rolled back; they are deployed to again.
 */
export interface RollbackTargets {
  current?: Deployment;
  options: Deployment[];
}

export async function listRollbackTargets(projectId: string): Promise<RollbackTargets> {
  const history = await api.listDeployments.all({
    project_id: projectId,
    expand: EXPAND_RELEASE,
    limit: PAGE_SIZE,
  });
  const primary = history.filter((deployment) => deployment.kind === "primary");
  const current = primary.find((deployment) => deployment.status === "live");
  const options = primary.filter(
    (deployment) =>
      deployment.status !== "live" &&
      deployment.release_id !== current?.release_id &&
      !releaseRevoked(deployment),
  );
  return { current, options };
}

/**
 * Makes the deployment's release live on the primary origins again, as a
 * new deployment that names the one rolled back to. `expectedDeploymentId`
 * is the deployment the operator saw as live: the server refuses when
 * another has landed since, rather than rolling back over it.
 */
export function rollbackDeployment(
  projectId: string,
  deploymentId: string,
  input: { message?: string; expectedDeploymentId?: string },
) {
  return api.rollbackDeployment(
    deploymentId,
    { project_id: projectId },
    {
      ...(input.message ? { message: input.message } : {}),
      ...(input.expectedDeploymentId ? { expected_deployment_id: input.expectedDeploymentId } : {}),
    },
  );
}
