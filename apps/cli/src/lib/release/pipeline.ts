import type { ZitadelClient } from "@zitadel/api/client";

import type { ConfigurationBundle } from "./bundle";

/** Which publish a step runs for. `preview` lands with the preview command. */
export type PipelineMode = "deploy" | "preview";

/**
 * What every step is handed. The bundle is built once by the command and shared
 * across the steps, so a step never re-reads `.zitadel/`.
 */
export interface StepContext {
  readonly cwd: string;
  readonly client: ZitadelClient;
  readonly projectId: string;
  readonly env: Record<string, string | undefined>;
  readonly mode: PipelineMode;
  /** No server write happens on a dry run; a writing step is skipped. */
  readonly dryRun: boolean;
  /** Colour and stray stdout are both suppressed under `--json`. */
  readonly json: boolean;
  readonly color: boolean;
  /** The one primary origin a deploy narrowed to with `--origin`, if any. */
  readonly origin?: string;
  readonly bundle: ConfigurationBundle;
}

/**
 * One stage of the publish pipeline. `runsFor` keeps a step out of the publishes
 * it does not belong to — the IdP sync is deploy-only, never preview — and
 * `writes` marks a step that mutates the server, so a dry run skips it while
 * still validating and showing the diff.
 */
export interface Step {
  readonly name: string;
  readonly runsFor: readonly PipelineMode[];
  readonly writes?: boolean;
  run(ctx: StepContext): Promise<void>;
}

/**
 * Run the before-release steps in order, skipping the ones that do not apply to
 * this publish or that write on a dry run. The command creates the release and
 * the deployment itself, between and after the step groups: before-release
 * steps → create release → before-deploy steps → create deployment.
 */
export async function runSteps(steps: readonly Step[], ctx: StepContext): Promise<void> {
  for (const step of steps) {
    if (!step.runsFor.includes(ctx.mode)) {
      continue;
    }
    if (ctx.dryRun && step.writes) {
      continue;
    }
    await step.run(ctx);
  }
}
