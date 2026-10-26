import type { ZitadelClient } from "@zitadel/api/client";

import { toZitadelError } from "../errors";
import type { SuggestedCommand } from "../suggestion";
import { buildBundle } from "./bundle";
import { createDeployment } from "./deployment";
import { headSha, worktreeIsDirty } from "./git";
import { runSteps, type StepContext } from "./pipeline";
import { createReleaseFromBundle } from "./release";
import { validateStep } from "./steps/validate";

/** What {@link runInitialDeploy} did, for its caller to report. */
export type InitialDeployOutcome =
  | {
      readonly kind: "deployed";
      readonly releaseId: string;
      readonly contentHash: string;
      readonly deploymentId: string;
      readonly origins: readonly string[];
      readonly resources: number;
    }
  /** The pipeline failed; everything before it stands. */
  | { readonly kind: "failed"; readonly message: string };

/**
 * Deploy the `.zitadel/` of this directory to a project that has never had a
 * release, so it is live off the developer's own files rather than off
 * whatever the server serves a project with nothing deployed to it.
 *
 * This is the publish pipeline `deploy` runs, not a second implementation of
 * it: build the bundle, validate it, create the release and deploy it to every
 * primary origin. The diff step is deliberately left out — nothing has ever
 * been deployed, so there is no baseline and by definition no diff, and
 * running it would only print that there is none.
 *
 * Nothing here prompts: the message is fixed, which is what lets the caller
 * decide whether to ask and then run this unchanged either way.
 */
export async function runInitialDeploy(opts: {
  readonly cwd: string;
  readonly client: ZitadelClient;
  readonly projectId: string;
  readonly env: Record<string, string | undefined>;
  readonly json: boolean;
  readonly color: boolean;
  readonly message: string;
  readonly suggest: (args: string) => SuggestedCommand;
}): Promise<InitialDeployOutcome> {
  try {
    const { bundle, resourceCount, brandingSources, idpFiles } = await buildBundle(opts.cwd);
    const ctx: StepContext = {
      cwd: opts.cwd,
      client: opts.client,
      projectId: opts.projectId,
      env: opts.env,
      mode: "deploy",
      dryRun: false,
      json: opts.json,
      color: opts.color,
      bundle,
      brandingSources,
      idpFiles,
      suggest: opts.suggest,
    };
    await runSteps([validateStep], ctx);

    const gitDirty = await worktreeIsDirty(opts.cwd);
    const release = await createReleaseFromBundle(opts.client, opts.projectId, bundle, {
      message: opts.message,
      gitSha: await headSha(opts.cwd),
      gitDirty,
    });
    // No optimistic guard: nothing has ever been deployed to this project, so
    // there is no deployment to race with.
    const deployment = await createDeployment(opts.client, opts.projectId, {
      releaseId: release.id,
      targets: ["primary"],
      message: opts.message,
    });
    return {
      kind: "deployed",
      releaseId: release.id,
      contentHash: release.content_hash,
      deploymentId: deployment.id,
      origins: deployment.targets.map((target) => target.origin),
      resources: resourceCount,
    };
  } catch (error) {
    return { kind: "failed", message: toZitadelError(error).message };
  }
}
