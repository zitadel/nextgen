import { BuildReleaseBody as BuildReleaseBodySchema } from "../backend/schemas";

import type { DeploymentService, ReleaseInput, VariableService } from "../backend";
import { ZitadelError } from "../errors";
import type { SuggestedCommand } from "../suggestion";
import { buildBundle, type ConfigurationBundle } from "./bundle";
import { headSha, worktreeIsDirty } from "./git";
import { type PipelineMode, runSteps, type StepContext, type StepReport } from "./pipeline";
import { diffStep } from "./steps/diff";
import { validateStep } from "./steps/validate";

/** What {@link Publisher.prepare} needs to know about the run that asks. */
export type PrepareRequest = Readonly<{
  /** The project directory whose `.zitadel/` is published. */
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  mode: PipelineMode;
  /** No server write happens on a dry run; a writing step is skipped. */
  dryRun: boolean;
  /** Whether to diff the bundle against what is live. */
  compare: boolean;
  /** Colour and stray stdout are both suppressed under `--json`. */
  json: boolean;
  color: boolean;
  /** A command against the project this run addresses, for a step's error to suggest its fix. */
  suggest: (args: string) => SuggestedCommand;
}>;

/** A bundle that has been built and checked, with the commit it was built from. */
export type PreparedRelease = Readonly<{
  bundle: ReleaseInput["bundle"];
  /** How many resources the bundle carries across every kind. */
  resourceCount: number;
  /** What the steps add to the command's `--json` data, such as the diff. */
  report: StepReport;
  /** Problems that do not stop the publish, for the command to report. */
  warnings: readonly string[];
  /** Text for the person reading the terminal, each ending in a newline. */
  notices: readonly string[];
  gitSha: string | undefined;
  gitDirty: boolean;
}>;

/**
 * Turns `.zitadel/` into a release ready to be created: it builds the bundle,
 * validates it against the project's live state, and optionally diffs it.
 *
 * @remarks
 * A Facade (Gang of Four) over the build and the steps, so a command asks for one prepared release and never wires the
 * pipeline itself. It reaches the server only through the services it is given,
 * and hands back whatever the steps had to say instead of printing it.
 */
export class Publisher {
  private readonly deployments: DeploymentService;
  private readonly variables: VariableService;

  constructor(deployments: DeploymentService, variables: VariableService) {
    this.deployments = deployments;
    this.variables = variables;
  }

  /**
   * Build the bundle and run the steps that check it.
   *
   * @param request - The directory, the mode, and how to show what the steps say.
   * @returns The bundle, what the steps reported, and the commit it was built from.
   * @throws ZitadelError `E_VALIDATION` naming each file a step refuses.
   */
  async prepare(request: PrepareRequest): Promise<PreparedRelease> {
    const built = await buildBundle(request.cwd);
    const context: StepContext = {
      cwd: request.cwd,
      deployments: this.deployments,
      variables: this.variables,
      env: request.env as Record<string, string | undefined>,
      mode: request.mode,
      dryRun: request.dryRun,
      json: request.json,
      color: request.color,
      bundle: built.bundle,
      brandingSources: built.brandingSources,
      idpFiles: built.idpFiles,
      policyFiles: built.policyFiles,
      suggest: request.suggest,
    };
    const outcome = await runSteps(
      request.compare ? [validateStep, diffStep] : [validateStep],
      context,
    );
    return {
      bundle: Publisher.narrow(built.bundle),
      resourceCount: built.resourceCount,
      report: outcome.data,
      warnings: outcome.warnings,
      notices: outcome.notices,
      gitSha: (await headSha(request.cwd)) ?? undefined,
      gitDirty: await worktreeIsDirty(request.cwd),
    };
  }

  /**
   * Narrow the bundle read from disk to the API's own type, so what is sent is
   * what the API takes. It is sent as read: the check fills in no defaults.
   *
   * @throws ZitadelError `E_VALIDATION` naming each field the API does not take.
   */
  private static narrow(bundle: ConfigurationBundle): ReleaseInput["bundle"] {
    const checked = BuildReleaseBodySchema.shape.bundle.safeParse(bundle);
    if (checked.success) {
      return bundle as ReleaseInput["bundle"];
    }
    const issues = checked.error.issues;
    const noun = issues.length === 1 ? "issue" : "issues";
    throw new ZitadelError(
      "E_VALIDATION",
      `The release body does not match what the API takes, so nothing was sent (${issues.length} ${noun}):\n` +
        issues
          .map((issue) => {
            return `  - bundle.${issue.path.join(".") || "(root)"} ${issue.message}`;
          })
          .join("\n"),
      {
        details: {
          issues,
        },
      },
    );
  }
}
