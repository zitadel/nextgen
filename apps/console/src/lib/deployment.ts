import type {
  ListDeployments200DeploymentsItem,
  ListDeploymentsParams,
} from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";

/**
 * Display helpers for the deployments a release detail lists.
 *
 * A deployment is an append-only record of a release going live on a set of
 * origins; what an origin serves is the newest deployment that names it. The
 * wire carries no state on the record, so the screen reads the history and
 * the live view and marks each history entry by whether the live view still
 * holds it.
 */

/** One entry of `GET /deployments`. */
export type Deployment = ListDeployments200DeploymentsItem;

/** Where a deployment went: the project's primary origins, or preview URLs. */
export type DeploymentKind = "primary" | "preview";

/**
 * `live`: some origin still serves it. `superseded`: every origin it named has
 * since been given a newer deployment, or its previews have expired.
 */
export type DeploymentStatus = "live" | "superseded";

export interface ReleaseDeployment {
  deployment: Deployment;
  kind: DeploymentKind;
  status: DeploymentStatus;
}

/** What the screens call each kind. */
export const KIND_LABEL: Record<DeploymentKind, string> = {
  primary: "Primary",
  preview: "Preview",
};

/**
 * A preview target carries the expiry its deployment set; a primary origin
 * never expires. One deployment never mixes the two, so one target decides.
 */
export function deploymentKind(deployment: Deployment): DeploymentKind {
  return deployment.targets.some((target) => target.expires_at) ? "preview" : "primary";
}

/** The most `GET /deployments` hands back per page. */
const PAGE_SIZE = 100;

/**
 * Whether a failed read means the server does not serve deployments yet.
 * That one answer is what the screens absorb; a refused or failed read is
 * the route's error to show, as on every other screen.
 */
export function isNotServed(error: unknown): boolean {
  return error instanceof ApiError && error.status === 501;
}

/**
 * Every deployment the filter matches, across pages. The live view is
 * bounded by the project's origins and a release's own history is a handful,
 * so walking the pages is the honest read while `GET /deployments` has no
 * filter by release.
 */
async function listAllDeployments(
  params: Omit<ListDeploymentsParams, "limit" | "page_token">,
): Promise<Deployment[]> {
  const all: Deployment[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.listDeployments({ ...params, limit: PAGE_SIZE, page_token: pageToken });
    all.push(...page.deployments);
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);
  return all;
}

/**
 * Reads where a release went, newest first, each marked live or superseded,
 * or `undefined` while the server does not serve deployments.
 *
 * Two reads: the project's history, and its live view. The live view is what
 * the targets serve now, so an entry of the history that it still holds is
 * live and every other one is superseded.
 */
export async function listReleaseDeployments(
  projectId: string,
  releaseId: string,
): Promise<ReleaseDeployment[] | undefined> {
  try {
    const [history, liveIds] = await Promise.all([
      listAllDeployments({ project_id: projectId }),
      listLiveDeploymentIds(projectId),
    ]);
    return mark(
      history.filter((deployment) => deployment.release_id === releaseId),
      liveIds,
    );
  } catch (error) {
    if (isNotServed(error)) return undefined;
    throw error;
  }
}

/** Each deployment with its kind, and live or superseded by whether the live view holds it. */
function mark(deployments: readonly Deployment[], liveIds: Set<string>): ReleaseDeployment[] {
  return deployments.map((deployment) => ({
    deployment,
    kind: deploymentKind(deployment),
    status: liveIds.has(deployment.id) ? "live" : "superseded",
  }));
}

/** How many rows the directory shows per `Load more` (D5). */
const TABLE_PAGE_SIZE = 25;

/** One page of the project's deployments, each marked live or superseded. */
export interface DeploymentPage {
  items: ReleaseDeployment[];
  nextPageToken?: string;
}

/**
 * The ids of the deployments some origin serves now. One read for the whole
 * directory: every page of the history is marked against the same set.
 */
export async function listLiveDeploymentIds(projectId: string): Promise<Set<string>> {
  const live = await listAllDeployments({ project_id: projectId, live: true });
  return new Set(live.map((deployment) => deployment.id));
}

/** One page of the project's history, newest first, marked against `liveIds`. */
export async function listProjectDeployments(
  projectId: string,
  liveIds: Set<string>,
  pageToken?: string,
): Promise<DeploymentPage> {
  const page = await api.listDeployments({
    project_id: projectId,
    limit: TABLE_PAGE_SIZE,
    page_token: pageToken,
  });
  return {
    items: mark(page.deployments, liveIds),
    nextPageToken: page.next_page_token ?? undefined,
  };
}
