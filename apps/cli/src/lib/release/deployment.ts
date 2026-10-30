import type { ZitadelClient } from "@zitadel/api/client";
import type {
  CreateDeployment200,
  CreateDeployment201,
  ListDeployments200DeploymentsItem,
  RollbackDeployment200,
  RollbackDeployment201,
} from "@zitadel/api/generated/model";

import { collectPages } from "../oclif/crud/paging";

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

/** A target as one string: its origin, or `default`. */
export function targetName(target: ListedDeployment["targets"][number]): string {
  return target.type === "default" ? "default" : target.origin;
}

/**
 * Every live deployment of the project, newest first, drained across pages: one
 * live preview per open pull request can push the primary origins' deployment
 * off the first page, and a guard, a baseline or a rollback read from that page
 * alone would quietly miss it.
 */
export async function listLiveDeployments(
  client: ZitadelClient,
  projectId: string,
  options: { origin?: string; withRelease?: boolean } = {},
): Promise<ListedDeployment[]> {
  const { items } = await collectPages(
    (token) =>
      client.listDeployments({
        project_id: projectId,
        live: true,
        ...(options.origin === undefined ? {} : { target: options.origin }),
        ...(options.withRelease ? { expand: ["release"] } : {}),
        ...(token === undefined ? {} : { page_token: token }),
      }),
    { items: "deployments", all: true, nextPageToken: "next_page_token" },
  );
  return items as ListedDeployment[];
}

/**
 * Whether a deployment serves a primary origin. A preview deployment's targets
 * carry an expiry; it is never the baseline, the guard or the thing a bare
 * rollback undoes. Neither is one that reaches only the default target.
 */
export function servesPrimary(deployment: Pick<ListedDeployment, "targets">): boolean {
  return deployment.targets.some((target) => target.type === "origin" && target.expires_at == null);
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
