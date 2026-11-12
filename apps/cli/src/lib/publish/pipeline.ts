import type { DeploymentService, SchemaService, UserService, VariableService } from "@/lib/backend";
import type { Suggest } from "@/lib/suggestion";
import type { ConfigStore, ConfigurationBundle, ZitadelConfig } from "@/lib/zitadel";

/**
 * The publishes a step can run for. `preview` lands with the preview command.
 */
export const PIPELINE_MODES = ["deploy", "preview"] as const;

/**
 * Which publish a step runs for.
 */
export type PipelineMode = (typeof PIPELINE_MODES)[number];

/**
 * The environment a run reads variables from, by name.
 */
export type RunEnvironment = { readonly [name: string]: string | undefined };

/**
 * Facts a step records for a later step to build on.
 */
export type Learned = {
  /**
   * Whether the schemas or flows differ from the live release: set by the diff
   * step when it can tell, and left unset when it cannot.
   */
  readonly schemasOrFlowsChanged?: boolean;
};

/**
 * What every step is handed. The bundle is built once by the command and shared
 * across the steps, so a step never re-reads `.zitadel/`.
 */
export type StepContext = {
  readonly cwd: string;
  readonly deployments: DeploymentService;
  readonly variables: VariableService;
  readonly schemas: SchemaService;
  readonly users: UserService;
  readonly env: RunEnvironment;
  readonly mode: PipelineMode;

  /**
   * No server write happens on a dry run; a writing step is skipped.
   */
  readonly dryRun: boolean;

  /**
   * Colour and stray stdout are both suppressed under `--json`.
   */
  readonly json: boolean;
  readonly color: boolean;

  /**
   * The configuration as authored, which every check reads instead of the disk.
   */
  readonly config: ZitadelConfig;

  /**
   * Whether the connections the project already has were needed to judge the
   * configuration but could not be listed, so advice that only holds before a
   * connection's first deploy cannot be given.
   */
  readonly deployedUnknown?: boolean;

  /**
   * Where the configuration is kept, for what a document reads beside it:
   * branding's `$file` references.
   */
  readonly store: ConfigStore;

  /**
   * The configuration as the release carries it. Its connections sit in
   * `config.connections` order.
   */
  readonly bundle: ConfigurationBundle;

  /**
   * A command against the project this run addresses, carrying its
   * environment selector, for a step's error to suggest its own fix.
   */
  readonly suggest: Suggest;

  /**
   * What the earlier steps of this publish learned, merged in the order they
   * ran. Left out where no step records it.
   */
  readonly learned?: Learned;
};

/**
 * What a step adds to its command's `--json` data, such as the diff step's
 * `diff`. A step with nothing to add returns nothing.
 */
export type StepReport = { readonly [key: string]: unknown };

/**
 * What a step has to say.
 *
 * @remarks
 * `data` joins the command's `--json` output, `warnings` are problems that do
 * not stop the publish, and `notices` are text for the person reading the
 * terminal, each ending in a newline. `lockouts` are existing users this
 * publish would leave unable to sign in, which the command must not deploy
 * without consent. `learned` is handed to the steps after it. A step with
 * nothing to say returns nothing.
 */
export type StepResult = {
  readonly data?: StepReport;
  readonly warnings?: readonly string[];
  readonly notices?: readonly string[];
  readonly lockouts?: readonly string[];
  readonly learned?: Learned;
};

/**
 * Everything the steps of one publish said, in the order they said it.
 */
export type StepsOutcome = {
  readonly data: StepReport;
  readonly warnings: readonly string[];
  readonly notices: readonly string[];
  readonly lockouts: readonly string[];
};

/**
 * One stage of the publish pipeline.
 *
 * @remarks
 * `runsFor` keeps a step out of the publishes it does not belong to — the IdP
 * sync is deploy-only, never preview — and `writes` marks a step that mutates
 * the server, so a dry run skips it while still validating and showing the
 * diff.
 */
export type Step = {
  readonly name: string;
  readonly runsFor: readonly PipelineMode[];
  readonly writes?: boolean;

  /**
   * Run the step.
   *
   * @param ctx - The publish, with what the earlier steps learned.
   * @returns What the step has to say, if anything.
   */
  run(ctx: StepContext): Promise<StepResult | undefined>;
};

/**
 * Where the steps of one publish have got to: what they said, and the context
 * the next one is handed.
 */
type Progress = {
  readonly outcome: StepsOutcome;
  readonly ctx: StepContext;
};

/**
 * Run the before-release steps in order, skipping the ones that do not apply to
 * this publish or that write on a dry run, and return what they said.
 *
 * @remarks
 * The command creates the release and the deployment itself, between and after
 * the step groups: before-release steps → create release → before-deploy steps
 * → create deployment. Each step is handed what every earlier one learned.
 *
 * @param steps - The steps, in the order they run.
 * @param ctx - The publish.
 * @returns What the steps said.
 * @throws Whatever a step throws, which stops the steps after it.
 */
export async function runSteps(steps: readonly Step[], ctx: StepContext): Promise<StepsOutcome> {
  const start: Progress = { outcome: { data: {}, warnings: [], notices: [], lockouts: [] }, ctx };
  const done = await steps.reduce(async (previous: Promise<Progress>, step) => {
    const progress = await previous;
    if (!step.runsFor.includes(ctx.mode)) {
      return progress;
    }
    if (ctx.dryRun && step.writes === true) {
      return progress;
    }
    const result = await step.run(progress.ctx);
    if (result === undefined) {
      return progress;
    }
    const outcome: StepsOutcome = {
      data: { ...progress.outcome.data, ...result.data },
      warnings: [...progress.outcome.warnings, ...(result.warnings ?? [])],
      notices: [...progress.outcome.notices, ...(result.notices ?? [])],
      lockouts: [...progress.outcome.lockouts, ...(result.lockouts ?? [])],
    };

    return {
      outcome,
      ctx: {
        ...progress.ctx,
        learned: { ...progress.ctx.learned, ...result.learned },
      },
    };
  }, Promise.resolve(start));

  return done.outcome;
}
