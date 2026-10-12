import type { ZitadelClient } from "@zitadel/api/client";
import type { CreateDeployment201, RollbackDeployment201 } from "@zitadel/api/generated/model";

/** A deployment, as create and rollback return it (the 200/201 shapes match). */
export type Deployment = CreateDeployment201;

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
  },
): Promise<Deployment> {
  const result = await client.createDeployment(
    {
      ...(input.releaseId === undefined ? {} : { release_id: input.releaseId }),
      ...(input.contentHash === undefined ? {} : { content_hash: input.contentHash }),
      targets: input.targets,
      ...(input.message === undefined ? {} : { message: input.message }),
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
