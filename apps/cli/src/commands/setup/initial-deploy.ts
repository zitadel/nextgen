import type { ZitadelClient } from "@zitadel/api/client";

import { toZitadelError } from "../../lib/errors";
import {
  buildBundle,
  createDeployment,
  createReleaseFromBundle,
  headSha,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import type { SuggestedCommand } from "../../lib/suggestion";

/** The message the release setup creates carries. */
export const INITIAL_DEPLOY_MESSAGE = "Initial deployment from zitadel setup";

/** What {@link runInitialDeploy} did, for setup to report. */
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
 * Deploy the `.zitadel/` setup just wrote, so the project is live off the
 * developer's own files from the first minute rather than off the fallback
 * resources the server seeds beside a project.
 *
 * This is the publish pipeline `deploy` runs, not a second implementation of
 * it: build the bundle, validate it, show the diff, create the release and
 * deploy it to every primary origin. Setup registered the app's own origin as
 * primary when it created the project, so there is always somewhere to land.
 *
 * The release is built after {@link ensureInitialCommit} has run, so it records
 * that commit and the next deploy has a baseline to diff against. Nothing here
 * prompts: the message is fixed, which is what lets it run unchanged in CI.
 */
export async function runInitialDeploy(opts: {
  readonly cwd: string;
  readonly client: ZitadelClient;
  readonly projectId: string;
  readonly env: Record<string, string | undefined>;
  readonly json: boolean;
  readonly color: boolean;
  readonly suggest: (args: string) => SuggestedCommand;
}): Promise<InitialDeployOutcome> {
  try {
    const { bundle, resourceCount, brandingSources, idpFiles, policyFiles } = await buildBundle(
      opts.cwd,
    );
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
      policyFiles,
      suggest: opts.suggest,
    };
    // Validate only. `deploy` also runs the diff step, which shows what
    // changed since the live release; here nothing has ever been deployed, so
    // there is no baseline and by definition no diff. Running it anyway would
    // print "No diff available: nothing is deployed yet" in the middle of
    // setup — the very sentence this deploy exists to stop the developer
    // seeing, and about a diff they never asked for.
    await runSteps([validateStep], ctx);

    const gitDirty = await worktreeIsDirty(opts.cwd);
    const release = await createReleaseFromBundle(opts.client, opts.projectId, bundle, {
      message: INITIAL_DEPLOY_MESSAGE,
      gitSha: await headSha(opts.cwd),
      gitDirty,
    });
    // No optimistic guard: the project was created moments ago and nothing has
    // ever been deployed to it, so there is no deployment to race with.
    const deployment = await createDeployment(opts.client, opts.projectId, {
      releaseId: release.id,
      targets: ["primary"],
      message: INITIAL_DEPLOY_MESSAGE,
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
