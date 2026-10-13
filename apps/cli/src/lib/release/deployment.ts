import type { ZitadelClient } from "@zitadel/api/client";
import type {
  CreateDeployment200,
  CreateDeployment201,
  RollbackDeployment200,
  RollbackDeployment201,
} from "@zitadel/api/generated/model";

/**
 * A deployment, as create returns it: the deployment record plus the
 * `warnings` the create response carries (the 200 and 201 shapes match). The
 * field is part of the generated model now, so callers read it directly rather
 * than casting a warnings shape onto a plain deployment.
 */
export type Deployment = CreateDeployment200 | CreateDeployment201;

/**
 * A rollback, as the server returns it: 201 when it wrote a new deployment, 200
 * when every target already served the target deployment and nothing changed.
 * Kept as the union — like {@link Deployment} — so a caller can tell the two
 * apart rather than having the no-op collapsed into a write.
 */
export type RolledBackDeployment = RollbackDeployment200 | RollbackDeployment201;

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
