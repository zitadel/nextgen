import type { ZitadelClient } from "@zitadel/api/client";
import type {
  CreateDeployment200,
  CreateDeployment201,
  RollbackDeployment201,
} from "@zitadel/api/generated/model";

/**
 * A deployment, as create returns it: the deployment record plus the
 * `warnings` the create response carries (the 200 and 201 shapes match). The
 * field is part of the generated model now, so callers read it directly rather
 * than casting a warnings shape onto a plain deployment.
 */
export type Deployment = CreateDeployment200 | CreateDeployment201;

/** What target a deploy goes to: every primary origin, or one exact origin. */
export type DeployTargets = ["primary"] | [string];

/**
 * Make a release live. The release is named by id or by content digest, never
 * both, and the targets are `primary` (every primary origin) or one exact
 * origin. The server answers 201 when it wrote a deployment and 200 when every
 * target already served the release.
 */
export async function createDeployment(
  client: ZitadelClient,
  projectId: string,
  input: {
    releaseId?: string;
    contentHash?: string;
    targets: string[];
    message?: string;
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
): Promise<RollbackDeployment201> {
  const body = {
    ...(options?.message === undefined ? {} : { message: options.message }),
    ...(options?.expectedDeploymentId === undefined
      ? {}
      : { expected_deployment_id: options.expectedDeploymentId }),
  };
  const result = await client.rollbackDeployment(
    deploymentId,
    { project_id: projectId },
    Object.keys(body).length === 0 ? undefined : body,
  );
  return result as RollbackDeployment201;
}
