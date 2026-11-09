import { BuildReleaseBody as BuildReleaseBodySchema } from "@/lib/backend/schemas";

import {
  type Deployment,
  DeploymentService,
  type DeployToPrimaryResult,
  IdpService,
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
import { isCancellation, ZitadelError } from "@/lib/errors";
import type { SuggestedCommand } from "@/lib/suggestion";
import { type ConfigurationBundle, DiskStore, ZitadelConfig } from "@/lib/zitadel";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { headSha, worktreeIsDirty } from "./git";
import {
  type PipelineMode,
  type RunEnvironment,
  runSteps,
  type StepContext,
  type StepReport,
} from "./pipeline";
import { diffStep } from "./steps/diff";
import { lockoutStep } from "./steps/lockout";
import { DEPLOYED_DEPENDENT_RULE, validateStep } from "./steps/validate";

/**
 * The bundle as the API takes it.
 */
type ReleaseBundle = ReleaseInput["bundle"];

/**
 * The configuration, and whether the connections the project has were needed
 * to judge it but could not be listed.
 */
type KnownConfig = {
  readonly config: ZitadelConfig;
  readonly deployedUnknown: boolean;
};

/**
 * What {@link Publisher.prepare} needs to know about the run that asks.
 */
export type PrepareRequest = {
  /**
   * The project directory whose `.zitadel/` is published.
   */
  readonly cwd: string;
  readonly env: RunEnvironment;
  readonly mode: PipelineMode;

  /**
   * No server write happens on a dry run; a writing step is skipped.
   */
  readonly dryRun: boolean;

  /**
   * Whether to diff the bundle against what is live.
   */
  readonly compare: boolean;

  /**
   * Colour and stray stdout are both suppressed under `--json`.
   */
  readonly json: boolean;
  readonly color: boolean;

  /**
   * A command against the project this run addresses, for a step's error to
   * suggest its fix.
   */
  readonly suggest: (args: string) => SuggestedCommand;
};

/**
 * A bundle that has been built and checked, with the commit it was built from.
 */
export type PreparedRelease = {
  readonly bundle: ReleaseBundle;

  /**
   * How many resources the bundle carries across every kind.
   */
  readonly resourceCount: number;

  /**
   * What the steps add to the command's `--json` data, such as the diff.
   */
  readonly report: StepReport;

  /**
   * Problems that do not stop the publish, for the command to report.
   */
  readonly warnings: readonly string[];

  /**
   * Text for the person reading the terminal, each ending in a newline.
   */
  readonly notices: readonly string[];

  /**
   * Existing users the release would leave unable to sign in, which the
   * command must not deploy without consent.
   */
  readonly lockouts: readonly string[];
  readonly gitSha: string | undefined;
  readonly gitDirty: boolean;
};

/**
 * What creating a release from a prepared bundle takes.
 */
export type ReleaseRequest = {
  readonly prepared: PreparedRelease;

  /**
   * A short summary of what the release changes, when the run has one.
   */
  readonly message?: string;
};

/**
 * What making a prepared bundle live on the primary origins takes.
 */
export type DeployRequest = ReleaseRequest & {
  /**
   * The primary origins the deploy lands on, which decide the concurrency guard.
   */
  readonly landing: readonly string[];
};

/**
 * The release a deploy created, and what deploying it came to.
 */
export type DeployOutcome = {
  readonly release: Release;
  readonly publication: DeployToPrimaryResult;
};

/**
 * What publishing a prepared bundle to a pull-request build's URLs takes.
 */
export type PreviewRequest = ReleaseRequest & {
  /**
   * The preview URLs the build registers.
   */
  readonly urls: readonly string[];

  /**
   * How long each preview stays live, as the wire's ISO-8601 duration.
   */
  readonly ttl?: string;
};

/**
 * The release a publication created, and the deployment that made it live.
 */
export type PublishOutcome = {
  readonly release: Release;
  readonly deployment: Deployment;
};

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
  private readonly connections: IdpService;

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
    this.connections = new IdpService(client, projectId);
  }

  /**
   * Fetch the project's origin patterns, which say where a deploy can land.
   *
   * @returns The patterns, as the server stores them.
   */
  async fetchLanding(): Promise<Origins> {
    return this.origins.list();
  }

  /**
   * Read the configuration, listing the project's connections only when a
   * check that depends on them could fire.
   *
   * @remarks
   * The configuration is first read without them, which gives the check's
   * advice for every connection. Only when that finds the advice somewhere is
   * the listing asked for and the configuration told of it.
   *
   * @param store - Where the configuration is kept.
   * @returns The configuration, and whether the listing was needed but could
   *   not be read.
   * @throws {@link ZitadelError} `E_CANCELLED` when the person stops the command.
   */
  private async loadKnowingDeployed(store: DiskStore): Promise<KnownConfig> {
    const unknown = await ZitadelConfig.loadUnchecked(store);
    const needsDeployed = SSO_RULES.flatMap((rule) => {
      return rule.check(unknown, {});
    }).some((issue) => {
      return issue.rule === DEPLOYED_DEPENDENT_RULE;
    });
    if (!needsDeployed) {
      return { config: unknown, deployedUnknown: false };
    }
    const deployed = await this.listDeployed();
    if (deployed === undefined) {
      return { config: unknown, deployedUnknown: true };
    }
    return { config: unknown.withOptions({ deployed }), deployedUnknown: false };
  }

  /**
   * List the connections the project has, treating any listing failure other
   * than the person stopping the command as not knowing, so it never hides
   * what the local files say.
   *
   * @returns The slugs, or undefined when the listing could not be read.
   * @throws {@link ZitadelError} `E_CANCELLED` when the person stops the command.
   */
  private async listDeployed(): Promise<ReadonlySet<string> | undefined> {
    try {
      return await this.connections.deployedSlugs();
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      return undefined;
    }
  }

  /**
   * Build the bundle and run the steps that check it.
   *
   * @remarks
   * The configuration is read knowing which connections the project already
   * has, so a check that only matters before a connection's first deploy is
   * left out for them; see {@link IdpService.deployedSlugs} for what
   * happens when that cannot be read. The connections are only listed when a
   * local connection could draw that check, so most runs ask nothing.
   *
   * @param request - The directory, the mode, and how to show what the steps say.
   * @returns The bundle, what the steps reported, and the commit it was built from.
   * @throws {@link ZitadelError} `E_VALIDATION` naming each file a step refuses.
   */
  async prepare(request: PrepareRequest): Promise<PreparedRelease> {
    const store = new DiskStore(request.cwd);
    // Each file's shape is the validate step's to check, with its own messages.
    const known = await this.loadKnowingDeployed(store);
    const config = known.config;
    const built = config.bundle(store);
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
      config,
      deployedUnknown: known.deployedUnknown,
      store,
      bundle: built.bundle,
      suggest: request.suggest,
      // The steps hand on what they learned, so a later one can stand on what
      // an earlier one found rather than reading it again.
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
    const steps = request.compare ? [validateStep, diffStep, lockoutStep] : [validateStep];
    const outcome = await runSteps(steps, context);
    // Together: neither answer depends on the other and each spawns git, so
    // asking in turn would cost a whole process for nothing.
    const [sha, dirty] = await Promise.all([headSha(request.cwd), worktreeIsDirty(request.cwd)]);
    return {
      bundle: Publisher.narrow(built.bundle),
      resourceCount: built.resourceCount,
      report: outcome.data,
      warnings: outcome.warnings,
      notices: outcome.notices,
      lockouts: outcome.lockouts,
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
      landing: request.landing,
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
    // No time to live sends none: the key is dropped on the wire, and the
    // server applies its default.
    const deployment = await this.deployments.create({
      release_id: release.id,
      targets: [...request.urls],
      message: request.message,
      ttl: request.ttl,
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
   * Whether the bundle read from disk is one the API takes.
   *
   * @param bundle - The bundle read from disk.
   * @returns Whether the API's own schema accepts it as it is.
   */
  private static isReleaseBundle(
    bundle: ConfigurationBundle,
  ): bundle is ConfigurationBundle & ReleaseBundle {
    return BuildReleaseBodySchema.shape.bundle.safeParse(bundle).success;
  }

  /**
   * Narrow the bundle read from disk to the API's own type, so what is sent is
   * what the API takes. It is sent as read: the check fills in no defaults.
   *
   * @param bundle - The bundle read from disk.
   * @returns The same bundle, typed as the API takes it.
   * @throws {@link ZitadelError} `E_VALIDATION` naming each field the API does
   *   not take.
   */
  private static narrow(bundle: ConfigurationBundle): ReleaseBundle {
    if (Publisher.isReleaseBundle(bundle)) {
      return bundle;
    }
    const issues = BuildReleaseBodySchema.shape.bundle.safeParse(bundle).error?.issues ?? [];
    const noun = issues.length === 1 ? "issue" : "issues";
    const lines = issues.map((issue) => {
      const field = issue.path.join(".") || "(root)";
      return `  - bundle.${field} ${issue.message}`;
    });
    throw new ZitadelError(
      "E_VALIDATION",
      `The release body does not match what the API takes, so nothing was sent (${issues.length} ${noun}):\n${lines.join("\n")}`,
      {
        details: {
          issues,
        },
      },
    );
  }
}
