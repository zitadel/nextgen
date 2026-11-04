import type { ConfigurationBundle, DeploymentService, VariableService } from "../backend";
import type { SuggestedCommand } from "../suggestion";

/** Which publish a step runs for. `preview` lands with the preview command. */
export type PipelineMode = "deploy" | "preview";

/**
 * What every step is handed. The bundle is built once by the command and shared
 * across the steps, so a step never re-reads `.zitadel/`.
 */
export interface StepContext {
  readonly cwd: string;
  readonly deployments: DeploymentService;
  readonly variables: VariableService;
  readonly env: Record<string, string | undefined>;
  readonly mode: PipelineMode;
  /** No server write happens on a dry run; a writing step is skipped. */
  readonly dryRun: boolean;
  /** Colour and stray stdout are both suppressed under `--json`. */
  readonly json: boolean;
  readonly color: boolean;
  readonly bundle: ConfigurationBundle;
  /**
   * The branding descriptors as authored, before `$file` inlining, so
   * `validate` can report a missing reference the wire bundle has dropped.
   */
  readonly brandingSources: readonly Record<string, unknown>[];
  /**
   * The connection files' names, positional with `bundle.idps`, so a check can
   * name the file a bad connection came from.
   */
  readonly idpFiles: readonly string[];
  /** The policy files' names, positional with `bundle.policies`, likewise. */
  readonly policyFiles: readonly string[];
  /**
   * A command against the project this run addresses, carrying its
   * environment selector, for a step's error to suggest its own fix.
   */
  readonly suggest: (args: string) => SuggestedCommand;
}

/**
 * What a step adds to its command's `--json` data, such as the diff step's
 * `diff`. A step with nothing to add returns nothing.
 */
export type StepReport = Readonly<Record<string, unknown>>;

/**
 * What a step has to say. `data` joins the command's `--json` output,
 * `warnings` are problems that do not stop the publish, and `notices` are text
 * for the person reading the terminal, each ending in a newline. A step with
 * nothing to say returns nothing.
 */
export type StepResult = Readonly<{
  data?: StepReport;
  warnings?: readonly string[];
  notices?: readonly string[];
}>;

/** Everything the steps of one publish said, in the order they said it. */
export type StepsOutcome = Readonly<{
  data: StepReport;
  warnings: readonly string[];
  notices: readonly string[];
}>;

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
  run(ctx: StepContext): Promise<StepResult | undefined>;
}

/**
 * Run the before-release steps in order, skipping the ones that do not apply to
 * this publish or that write on a dry run, and return what they said. The command creates the release and the deployment
 * itself, between and after the step groups: before-release steps → create
 * release → before-deploy steps → create deployment.
 */
export async function runSteps(steps: readonly Step[], ctx: StepContext): Promise<StepsOutcome> {
  const data: Record<string, unknown> = {};
  const warnings: string[] = [];
  const notices: string[] = [];
  for (const step of steps) {
    if (!step.runsFor.includes(ctx.mode) || (ctx.dryRun && step.writes)) {
      continue;
    }
    const result = await step.run(ctx);
    Object.assign(data, result?.data);
    warnings.push(...(result?.warnings ?? []));
    notices.push(...(result?.notices ?? []));
  }
  return Object.freeze({ data, warnings, notices });
}
