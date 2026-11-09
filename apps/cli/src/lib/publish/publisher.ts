import { BuildReleaseBody as BuildReleaseBodySchema } from "@/lib/backend/schemas";

import {
  type Deployment,
  DeploymentService,
  type DeployToPrimaryResult,
  type Origins,
  OriginService,
  type Release,
  type ReleaseInput,
  ReleaseService,
  SchemaService,
  UserService,
  VariableService,
  type ZitadelClient,
} from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import type { SuggestedCommand } from "@/lib/suggestion";
import { buildBundle, type ConfigurationBundle } from "./bundle";
import { headSha, worktreeIsDirty } from "./git";
import { type PipelineMode, runSteps, type StepContext, type StepReport } from "./pipeline";
import { diffStep } from "./steps/diff";
import { lockoutStep } from "./steps/lockout";
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

/** What creating a release from a prepared bundle takes. */
export type ReleaseRequest = Readonly<{
  prepared: PreparedRelease;
  /** A short summary of what the release changes, when the run has one. */
  message?: string;
}>;

/** What making a prepared bundle live on the primary origins takes. */
export type DeployRequest = Readonly<{
  prepared: PreparedRelease;
  message?: string;
}>;

/** The release a deploy created, and what deploying it came to. */
export type DeployOutcome = Readonly<{
  release: Release;
  publication: DeployToPrimaryResult;
}>;

/** What publishing a prepared bundle to a pull-request build's URLs takes. */
export type PreviewRequest = Readonly<{
  prepared: PreparedRelease;
  message?: string;
  /** The preview URLs the build registers. */
  urls: readonly string[];
  /** How long each preview stays live, as the wire's ISO-8601 duration. */
  ttl?: string;
}>;

/** The release a publication created, and the deployment that made it live. */
export type PublishOutcome = Readonly<{
  release: Release;
  deployment: Deployment;
}>;

/**
 * Publishing `.zitadel/` to one project: building the release, checking it, and
 * making it live.
 *
 * @remarks
 * A Facade (Gang of Four) over the build, the steps and the services a publish
 * needs, so a command holds one object rather than wiring four services and the
 * pipeline itself. It hands back whatever the steps had to say instead of
 * printing it, so the command words every warning and result.
 */
export class Publisher {
  private readonly releases: ReleaseService;
  private readonly deployments: DeploymentService;
  private readonly variables: VariableService;
  private readonly origins: OriginService;
  private readonly schemas: SchemaService;
  private readonly users: UserService;

  /**
   * Bind a publisher to one project.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project being published to.
   */
  constructor(client: ZitadelClient, projectId: string) {
    this.releases = new ReleaseService(client, projectId);
    this.deployments = new DeploymentService(client, projectId);
    this.variables = new VariableService(client, projectId);
    this.origins = new OriginService(client, projectId);
    this.schemas = new SchemaService(client, projectId);
    this.users = new UserService(client);
  }

  /**
   * The project's origin patterns, which say where a deploy can land.
   *
   * @returns The patterns, as the server stores them.
   */
  async landing(): Promise<Origins> {
    return this.origins.list();
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
      schemas: this.schemas,
      users: this.users,
      env: request.env,
      mode: request.mode,
      dryRun: request.dryRun,
      json: request.json,
      color: request.color,
      bundle: built.bundle,
      brandingSources: built.brandingSources,
      idpFiles: built.idpFiles,
      policyFiles: built.policyFiles,
      suggest: request.suggest,
      // The steps record what they learned here, so a later one can stand on
      // what an earlier one found rather than reading it again.
      learned: {},
    };
    // Validate, then diff, which `--json` reports as `diff` on a dry run and a
    // deploy alike, then the lockout check, which only matters when the diff
    // found schemas or flows changed.
    //
    // Both run only against a release compared with what is live. A project's
    // first release has no users to lock out and no live release to compare
    // with, so asking after them would cost requests to answer nothing, and a
    // read refused on a project created moments ago would warn about a check
    // that was never worth running.
    const outcome = await runSteps(
      request.compare ? [validateStep, diffStep, lockoutStep] : [validateStep],
      context,
    );
    // Together: neither answer depends on the other and each spawns git, so
    // asking in turn would cost a whole process for nothing.
    const [sha, dirty] = await Promise.all([headSha(request.cwd), worktreeIsDirty(request.cwd)]);
    return {
      bundle: Publisher.narrow(built.bundle),
      resourceCount: built.resourceCount,
      report: outcome.data,
      warnings: outcome.warnings,
      notices: outcome.notices,
      gitSha: sha ?? undefined,
      gitDirty: dirty,
    };
  }

  /**
   * Create the release a prepared bundle builds, without deploying it.
   *
   * @param request - The prepared bundle and the release's message.
   * @returns The release, new or the one the content already built.
   * @throws ConflictError when the content matches a release that was revoked.
   */
  async createRelease(request: ReleaseRequest): Promise<Release> {
    return this.releases.create({
      bundle: request.prepared.bundle,
      message: request.message,
      git_sha: request.prepared.gitSha,
      git_dirty: request.prepared.gitDirty,
    });
  }

  /**
   * Create the release and make it live on the primary origins, guarded against
   * a deploy that raced in.
   *
   * @param request - The prepared bundle, the message and the origins it lands on.
   * @returns The release, and whether the deploy landed, lost a race, or met a revoked release.
   */
  async deploy(request: DeployRequest): Promise<DeployOutcome> {
    const release = await this.createRelease(request);
    const publication = await this.deployments.deployToPrimary({
      releaseId: release.id,
      message: request.message,
    });
    return {
      release,
      publication,
    };
  }

  /**
   * Create the release and make it live on a pull-request build's preview URLs,
   * each expiring after the given time to live.
   *
   * @param request - The prepared bundle, the message, the URLs and the time to live.
   * @returns The release and the deployment that registered the previews.
   */
  async preview(request: PreviewRequest): Promise<PublishOutcome> {
    const release = await this.createRelease(request);
    const deployment = await this.deployments.create({
      release_id: release.id,
      targets: [...request.urls],
      message: request.message,
      ...(request.ttl === undefined
        ? {}
        : {
            ttl: request.ttl,
          }),
    });
    return {
      release,
      deployment,
    };
  }

  /**
   * Create the release and make it live on every primary origin, for a project
   * nothing has been deployed to yet. No guard is sent, because there is no
   * deployment to race with.
   *
   * @param request - The prepared bundle and the release's message.
   * @returns The release and the deployment that made it live.
   */
  async deployInitial(request: ReleaseRequest): Promise<PublishOutcome> {
    const release = await this.createRelease(request);
    const deployment = await this.deployments.create({
      release_id: release.id,
      targets: "primary",
      message: request.message,
    });
    return {
      release,
      deployment,
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
