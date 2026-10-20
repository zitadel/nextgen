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
 * Every deployment the filter matches, across pages. A release's own history
 * is a handful, so walking the pages is the honest read while
 * `GET /deployments` has no filter by release.
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

/** Where a release went, newest first. */
export async function listReleaseDeployments(
  projectId: string,
  releaseId: string,
): Promise<Deployment[]> {
  const history = await listAllDeployments({ project_id: projectId });
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
 * Makes a release live on every primary origin, with the message on the
 * record. When the origins already serve the release with the same values
 * the server writes nothing and answers with the deployment that is live.
 */
export function deployToPrimary(projectId: string, releaseId: string, message?: string) {
  return api.createDeployment(
    { release_id: releaseId, targets: [PRIMARY_TARGET], ...(message ? { message } : {}) },
    { project_id: projectId },
  );
}
