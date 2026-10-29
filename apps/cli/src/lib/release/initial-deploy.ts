import type { ZitadelClient } from "@zitadel/api/client";

import type { SuggestedCommand } from "../suggestion";
import { buildBundle } from "./bundle";
import { createDeployment, PROJECT_TARGETS } from "./deployment";
import { headSha, worktreeIsDirty } from "./git";
import { runSteps, type StepContext } from "./pipeline";
import { createReleaseFromBundle } from "./release";
import { validateStep } from "./steps/validate";

/** What the first deploy of a project published. */
export type InitialDeployment = {
  readonly releaseId: string;
  readonly contentHash: string;
  readonly deploymentId: string;
  readonly origins: readonly string[];
};

/**
 * Publish `.zitadel/` to a project nothing has been deployed to, the way
 * `deploy` does: build the bundle, validate it, create the release and deploy
 * it to every primary origin and the default target. `deploy`'s diff step is
 * left out, because there is no live release to diff against, and so is its
 * optimistic guard, because there is no deployment to race with.
 */
export async function deployInitialRelease(input: {
  client: ZitadelClient;
  projectId: string;
  cwd: string;
  env: Record<string, string | undefined>;
  json: boolean;
  color: boolean;
  message: string;
  suggest: (args: string) => SuggestedCommand;
}): Promise<InitialDeployment> {
  const { bundle, brandingSources, idpFiles, policyFiles } = await buildBundle(input.cwd);
  const ctx: StepContext = {
    cwd: input.cwd,
    client: input.client,
    projectId: input.projectId,
    env: input.env,
    mode: "deploy",
    dryRun: false,
    json: input.json,
    color: input.color,
    bundle,
    brandingSources,
    idpFiles,
    policyFiles,
    suggest: input.suggest,
  };
  await runSteps([validateStep], ctx);
  const release = await createReleaseFromBundle(input.client, input.projectId, bundle, {
    message: input.message,
    gitSha: await headSha(input.cwd),
    gitDirty: await worktreeIsDirty(input.cwd),
  });
  const deployment = await createDeployment(input.client, input.projectId, {
    releaseId: release.id,
    targets: [...PROJECT_TARGETS],
    message: input.message,
  });
  return {
    releaseId: release.id,
    contentHash: release.content_hash,
    deploymentId: deployment.id,
    origins: deployment.targets.map((target) => target.origin),
  };
}
