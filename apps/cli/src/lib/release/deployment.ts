import type { ZitadelClient } from "@zitadel/api/client";
import type { CreateDeployment201, RollbackDeployment201 } from "@zitadel/api/generated/model";

/**
 * A non-fatal advisory a deployment create returns alongside the deployment: a
 * preview deploy that froze an `all` secret because the variable has no preview
 * override, so the preview URL serves the production credential (ADR 062 §7,
 * #1617). Allowed, but worth surfacing.
 */
export type DeploymentWarning = { code: string; message: string; variable: string };

/**
 * A deployment, as create and rollback return it (the 200/201 shapes match).
 * `warnings` is not in the generated 201 shape yet — the server emits it ahead
 * of the OpenAPI regen — so it is carried here as an optional field.
 */
export type Deployment = CreateDeployment201 & { readonly warnings?: readonly DeploymentWarning[] };

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
  return result as Deployment;
}

/**
 * Re-apply a deployment: a new deployment with its release and its targets,
 * recorded as a rollback. Returns 200 when the targets already serve it.
 */
export async function rollbackDeployment(
  client: ZitadelClient,
  projectId: string,
  deploymentId: string,
  message?: string,
): Promise<RollbackDeployment201> {
  const result = await client.rollbackDeployment(
    deploymentId,
    { project_id: projectId },
    message === undefined ? undefined : { message },
  );
  return result as RollbackDeployment201;
}
