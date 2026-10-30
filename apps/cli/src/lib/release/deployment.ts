import type { ZitadelClient } from "@zitadel/api/client";
import type {
  CreateDeployment200,
  CreateDeployment201,
  ListDeployments200DeploymentsItem,
  RollbackDeployment200,
  RollbackDeployment201,
} from "@zitadel/api/generated/model";

/**
 * A deployment, as create returns it: 200 when every target already served it,
 * 201 when it wrote a new one. The two shapes match.
 */
export type Deployment = CreateDeployment200 | CreateDeployment201;

/**
 * A rollback, as the server returns it: 201 when it wrote a new deployment, 200
 * when every target already served the target deployment and nothing changed.
 * Kept as the union — like {@link Deployment} — for fidelity to the API contract
 * rather than casting one arm away. The two bodies are structurally identical
 * and the client does not surface the status code, so a caller cannot yet tell a
 * no-op from a write; distinguishing them would need the status threaded through.
 */
export type RolledBackDeployment = RollbackDeployment200 | RollbackDeployment201;

/** One row of the deployment list. */
export type ListedDeployment = ListDeployments200DeploymentsItem;

/**
 * Whether a deployment serves a primary origin. A preview deployment's targets
 * carry an expiry; it is never the baseline, the guard or the thing a bare
 * rollback undoes. Look past the first page for it ({@link
 * newestPrimaryDeployments}): one live preview per open pull request can push
 * it off the first.
 */
export function servesPrimary(deployment: Pick<ListedDeployment, "targets">): boolean {
  return deployment.targets.some((target) => target.expires_at == null);
}

/**
 * The newest primary deployments the query lists, at most `count`, newest
 * first: from the project's history, or with `live` from what it serves now.
 * The list is read page by page and no further than they take: a primary
 * deployment can sit beyond the first page behind live previews.
 */
export async function newestPrimaryDeployments(
  client: ZitadelClient,
  query: Readonly<{ project_id: string; live?: boolean }>,
  count: number,
): Promise<ListedDeployment[]> {
  const found: ListedDeployment[] = [];
  if (count <= 0) {
    return found;
  }
  // The largest page the server allows, so a long history takes few requests.
  for await (const deployment of client.listDeployments.items({
    ...query,
    limit: 100,
  })) {
    if (servesPrimary(deployment)) {
      found.push(deployment);
      if (found.length === count) {
        break;
      }
    }
  }
  return found;
}

/** What target a deploy goes to: every primary origin, or one exact origin. */
export type DeployTargets = ["primary"] | [string];

/**
 * Make a release live. The release is named by id or by content digest, never
 * both, and the targets are `primary` (every primary origin), one exact primary
 * origin, or the preview URLs a pull-request build registers. `ttl` sets how
 * long each preview stays live and is only valid with preview URLs. The server
 * answers 201 when it wrote a deployment and 200 when every target already
 * served the release.
 */
export async function createDeployment(
  client: ZitadelClient,
  projectId: string,
  input: {
    releaseId?: string;
    contentHash?: string;
    targets: string[];
    message?: string;
    ttl?: string;
    /**
     * Optimistic-concurrency guard: the deployment the caller believes is the
     * newest one to the targets. The server answers 409 (`dep.conflict`) when
     * another deploy raced in, so nothing is overwritten unseen.
     */
    expectedDeploymentId?: string;
  },
): Promise<Deployment> {
  const result = await client.createDeployment(
    {
      ...(input.releaseId === undefined ? {} : { release_id: input.releaseId }),
      ...(input.contentHash === undefined ? {} : { content_hash: input.contentHash }),
      targets: input.targets,
      ...(input.message === undefined ? {} : { message: input.message }),
      ...(input.ttl === undefined ? {} : { ttl: input.ttl }),
      ...(input.expectedDeploymentId === undefined
        ? {}
        : { expected_deployment_id: input.expectedDeploymentId }),
    },
    { project_id: projectId },
  );
  return result;
}

/**
 * Re-apply a deployment: a new deployment with its release and its targets,
 * recorded as a rollback. Returns 200 when the targets already serve it.
 */
export async function rollbackDeployment(
  client: ZitadelClient,
  projectId: string,
  deploymentId: string,
  options?: {
    message?: string;
    /**
     * Optimistic-concurrency guard: the deployment the caller believes is the
     * newest one to the targets. The server answers 409 (`dep.conflict`) when
     * another deploy raced in between the caller reading state and this write,
     * so a rollback never overwrites a change the caller never saw.
     */
    expectedDeploymentId?: string;
  },
): Promise<RolledBackDeployment> {
  const body = {
    ...(options?.message === undefined ? {} : { message: options.message }),
    ...(options?.expectedDeploymentId === undefined
      ? {}
      : { expected_deployment_id: options.expectedDeploymentId }),
  };
  return client.rollbackDeployment(
    deploymentId,
    { project_id: projectId },
    Object.keys(body).length === 0 ? undefined : body,
  );
}
