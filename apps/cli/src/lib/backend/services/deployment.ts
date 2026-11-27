import type {
  CreateDeploymentBody,
  ListDeployments200DeploymentsItem,
  ListDeploymentsParams,
  RollbackDeploymentBody,
} from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { isCancelled, pagedFunctions, type ZitadelClient } from "@/lib/backend/client";
import { ConflictError } from "@/lib/backend/errors";

import { OriginService } from "./origin";
import { Variable } from "./variable";

/** What {@link DeploymentService.deployToPrimary} makes live. */
export type DeployToPrimaryRequest = Readonly<{
  releaseId: string;
  message?: string;
}>;

/**
 * What publishing a release to the primary origins came to.
 *
 * `raced` means another deploy landed between reading what the origins serve
 * and writing, so nothing was overwritten; `current` is that deployment, and is
 * undefined when it could not be read.
 * `revoked` means the release was revoked before it could be deployed, which
 * is not a race: trying again fails the same way.
 */
export type DeployToPrimaryResult = Readonly<
  | {
      outcome: "deployed";
      deployment: Deployment;
    }
  | {
      outcome: "raced";
      current: Deployment | undefined;
    }
  | {
      outcome: "revoked";
    }
>;

/**
 * What {@link DeploymentService.extendPrimary} came to: `deployToPrimary`'s
 * outcomes, `unchanged` when the newest primary deployment already names the
 * origin, and `none` when the project has no primary deployment to extend.
 */
export type ExtendPrimaryResult = Readonly<
  DeployToPrimaryResult | { outcome: "unchanged" | "none" }
>;

/** The deployment a rollback re-applies, and the one it expects to be live. */
type RollbackTarget = Readonly<{
  id: string;
  expectedDeploymentId: string | undefined;
}>;

/**
 * What a rollback would re-apply, decided from the primary deployments: a
 * named deployment is taken as given, and a bare rollback undoes the newest.
 */
export type RollbackPlan = Readonly<
  | {
      outcome: "target";
      target: RollbackTarget;
    }
  | {
      outcome: "nothing-deployed";
    }
  | {
      outcome: "nothing-earlier";
    }
>;

/**
 * What is live on a target, or why nothing is.
 *
 * `ambiguous` means no origin was named and more than one deployment is live,
 * so there is no single answer; `origins` are the ones to choose from.
 * `nothing-deployed` says why the target has no deployment: `none` when no
 * origin was named and nothing is live, `primary` for a primary origin nothing
 * has been deployed to, `preview` for a preview URL only a pull-request build
 * serves, and `unknown-origin` for a URL that is not an origin of the project.
 */
export type LiveOnResult = Readonly<
  | {
      outcome: "live";
      deployment: Deployment;
    }
  | {
      outcome: "ambiguous";
      origins: readonly string[];
    }
  | {
      outcome: "nothing-deployed";
      reason: "none" | "primary" | "preview" | "unknown-origin";
    }
>;

/** What making a release live takes: the release, the targets and the optional guard. */
export type DeploymentInput = Readonly<CreateDeploymentBody>;

/** The most deployments the API returns in one page, so a search takes the fewest requests. */
const PAGE_SIZE = 100;

/** What narrows a list of deployments. */
export type DeploymentQuery = Readonly<
  Omit<ListDeploymentsParams, "project_id" | "limit" | "page_token">
>;

/** What narrows and pages the deployment history. */
export type DeploymentPageQuery = Readonly<Omit<ListDeploymentsParams, "project_id">>;

/** What a rollback may carry beyond the deployment it re-applies. */
export type RollbackInput = Readonly<RollbackDeploymentBody>;

/**
 * A deployment: a release made live on some origins, and what that implies.
 *
 * @remarks
 * A rich Value Object (Fowler, PoEAA): immutable, and it carries the questions
 * a caller asks of it, so a command writes `deployment.servesPrimary` and never
 * digs through the targets itself. It serialises to the record the API sent.
 */
export class Deployment {
  readonly id: string;
  readonly release_id: string;
  readonly targets: ListDeployments200DeploymentsItem["targets"];
  readonly deployed_at: string;
  readonly metadata: ListDeployments200DeploymentsItem["metadata"];
  declare readonly release?: ListDeployments200DeploymentsItem["release"];
  private readonly record: ListDeployments200DeploymentsItem;

  /**
   * Build a deployment from a record the API reported.
   *
   * @param record - The record as the API sent it.
   */
  private constructor(record: ListDeployments200DeploymentsItem) {
    this.id = record.id;
    this.release_id = record.release_id;
    this.targets = record.targets;
    this.deployed_at = record.deployed_at;
    this.metadata = record.metadata;
    if (record.release !== undefined) {
      this.release = record.release;
    }
    this.record = record;
  }

  /**
   * Wrap a deployment the API reported.
   *
   * @param record - The record as the API sent it.
   * @returns The deployment.
   */
  static of(record: ListDeployments200DeploymentsItem): Deployment {
    return new Deployment(record);
  }

  /**
   * The origins this deployment serves.
   *
   * @returns One origin per target.
   */
  get origins(): readonly string[] {
    return this.targets.map((target) => {
      return target.origin;
    });
  }

  /**
   * Whether this deployment serves a primary origin. A preview deployment is
   * never the baseline, the guard or the thing a bare rollback undoes.
   *
   * @returns True when the API recorded it as a primary deployment.
   */
  get servesPrimary(): boolean {
    return this.record.kind === "primary";
  }

  /**
   * Whether this deployment served primary origins or preview URLs.
   *
   * @returns The kind the API recorded, which it always records.
   */
  get kind(): ListDeployments200DeploymentsItem["kind"] {
    return this.record.kind;
  }

  /**
   * Whether a preview URL still serves this deployment.
   *
   * @returns True for a preview deployment the API reports live.
   */
  get servesLivePreview(): boolean {
    return this.record.kind === "preview" && this.record.status === "live";
  }

  /**
   * When the preview this deployment made expires. A deployment a later one
   * replaced is not what its URL serves now, so it has no expiry of its own.
   *
   * @remarks
   * It reads the deployment's own origins, so ask it of the deployment as the
   * live view lists it ({@link DeploymentService.servingLivePreviews}), whose
   * origins are only those it still serves.
   *
   * @param expiries - Each live preview's expiry, by origin.
   * @returns The earliest expiry among the origins that still have a live
   *   preview, or an empty string when this deployment is not live or is not
   *   a preview one.
   */
  expiryAmong(expiries: ReadonlyMap<string, string>): string {
    if (!this.servesLivePreview) {
      return "";
    }
    const found = this.origins.flatMap((origin) => {
      const expiresAt = expiries.get(origin);
      return expiresAt === undefined ? [] : [expiresAt];
    });
    return (
      found.sort((first, second) => {
        return Date.parse(first) - Date.parse(second);
      })[0] ?? ""
    );
  }

  /**
   * Why this deployment was made: a deploy, a rollback, a preview.
   *
   * @returns The reason the API recorded, which it always records.
   */
  get reason(): ListDeployments200DeploymentsItem["metadata"]["reason"] {
    return this.metadata.reason;
  }

  /**
   * The record the API sent, which is what the JSON output carries.
   *
   * @returns The record.
   */
  toJSON(): ListDeployments200DeploymentsItem {
    return this.record;
  }
}

/**
 * The deployments of one project: reading them, making a release live, and
 * undoing that.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class DeploymentService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and the project every call concerns.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project every call concerns.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
    this.projectId = projectId;
  }

  /**
   * List the deployments, across all pages.
   *
   * @param query - The filters: live ones only, one origin, the release each serves.
   * @returns The deployments, newest first.
   */
  async list(query: DeploymentQuery = {}): Promise<readonly Deployment[]> {
    const records = await this.client.listDeployments.all({
      project_id: this.projectId,
      ...query,
    });
    return records.map((record) => {
      return Deployment.of(record);
    });
  }

  /**
   * List the deployment history, a page at a time.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(
    query: DeploymentPageQuery = {},
    options: PageOptions = {},
  ): Promise<Page<Deployment>> {
    const paging = new Paging(pagedFunctions.listDeployments);
    const pages = this.client.listDeployments.pages({
      project_id: this.projectId,
      ...query,
    });
    const collected = await paging.collect(pages, {
      all: options.all === true,
    });
    return {
      items: collected.items.map((record) => {
        return Deployment.of(record);
      }),
      next: collected.next,
    };
  }

  /**
   * The live preview deployments on a page, each narrowed to the origins it
   * still serves.
   *
   * @remarks
   * The history names every origin a deployment was made live on, and the live
   * view only those it still serves. A deployment a later one replaced on some
   * of its origins is therefore asked of the live view, so what is said of it
   * covers only what it serves.
   *
   * @param deployments - A page of deployments.
   * @param isLiveView - Whether the page is itself the live view, whose targets
   *   are already the ones served, so nothing more is read.
   * @returns The page's live preview deployments as the live view lists them,
   *   by id. One the live view no longer lists is absent, and it makes the read
   *   go through every page of the live view. Nothing is read when the page
   *   has none.
   */
  async servingLivePreviews(
    deployments: readonly Deployment[],
    isLiveView: boolean,
  ): Promise<ReadonlyMap<string, Deployment>> {
    const wanted = new Set(
      deployments
        .filter((deployment) => {
          return deployment.servesLivePreview;
        })
        .map((deployment) => {
          return deployment.id;
        }),
    );
    if (wanted.size === 0) {
      return new Map();
    }
    if (isLiveView) {
      return new Map(
        deployments
          .filter((deployment) => {
            return wanted.has(deployment.id);
          })
          .map((deployment) => {
            return [deployment.id, deployment] as const;
          }),
      );
    }
    const found = new Map<string, Deployment>();
    const paging = new Paging(pagedFunctions.listDeployments);
    const pages = this.client.listDeployments.pages({
      project_id: this.projectId,
      live: true,
      limit: PAGE_SIZE,
    });
    for await (const page of pages) {
      for (const record of paging.items(page)) {
        if (wanted.has(record.id)) {
          found.set(record.id, Deployment.of(record));
        }
      }
      if (found.size === wanted.size) {
        break;
      }
    }
    return found;
  }

  /**
   * Read one deployment.
   *
   * @remarks
   * The record alone, because reading it takes only `deployment.read` while the
   * variables it froze take `variable.read` as well: a caller that wants both
   * asks {@link DeploymentService.variables} for the second, so a credential
   * allowed to inspect deployments is not refused for a value it never wanted.
   *
   * @param deploymentId - The deployment to read.
   * @returns The deployment.
   */
  async get(deploymentId: string): Promise<Deployment> {
    const record = await this.client.getDeployment(deploymentId, {
      project_id: this.projectId,
    });
    return Deployment.of(record);
  }

  /**
   * Read the variables a deployment froze when it was made.
   *
   * @param deploymentId - The deployment to read.
   * @returns The frozen variables. A secret is named, never disclosed.
   */
  async variables(deploymentId: string): Promise<readonly Variable[]> {
    const frozen = await this.client.listDeploymentVariables(deploymentId, {
      project_id: this.projectId,
    });
    return Variable.fromValues(frozen);
  }

  /**
   * List the deployments serving traffic now.
   *
   * @param origin - Narrow to the deployment serving this origin.
   * @returns The live deployments.
   */
  async live(origin?: string): Promise<readonly Deployment[]> {
    return this.list({
      live: true,
      origin,
    });
  }

  /**
   * List the deployments serving a primary origin now. A live preview is never
   * one, even when it is the newest in the project.
   *
   * @param query - Narrow to one origin, or expand what each carries. It cannot
   * say whether to read the live ones: these are the live ones.
   * @returns The live deployments that never expire, newest first.
   */
  async primary(query: Omit<DeploymentQuery, "live"> = {}): Promise<readonly Deployment[]> {
    const live = await this.list({
      ...query,
      live: true,
    });
    return live.filter((deployment) => {
      return deployment.servesPrimary;
    });
  }

  /**
   * Find the newest deployment serving a primary origin.
   *
   * @returns The deployment, or undefined when nothing is deployed to a primary origin.
   */
  async newestPrimary(): Promise<Deployment | undefined> {
    const [newest] = await this.primary();
    return newest;
  }

  /**
   * Find the deployment live on a target. Without an origin, more than one live
   * deployment means there is no single one to show, because each origin may run
   * a different one. A target with nothing deployed says why, from what the
   * project's origins are.
   *
   * @param origin - The origin to read, or omitted for the project's one live deployment.
   * @returns The deployment, the origins to choose from, or why nothing is deployed.
   */
  async liveOn(origin?: string): Promise<LiveOnResult> {
    const deployments = await this.live(origin);
    if (origin === undefined && deployments.length > 1) {
      const origins = new Set(
        deployments.flatMap((deployment) => {
          return deployment.origins;
        }),
      );
      return {
        outcome: "ambiguous",
        origins: [...origins].sort(),
      };
    }
    const [deployment] = deployments;
    if (deployment !== undefined) {
      return {
        outcome: "live",
        deployment,
      };
    }
    if (origin === undefined) {
      return {
        outcome: "nothing-deployed",
        reason: "none",
      };
    }
    const originService = new OriginService(this.client, this.projectId);
    const origins = await originService.list();
    const kind = origins.kindOf(origin);
    return {
      outcome: "nothing-deployed",
      reason: kind === "unknown" ? "unknown-origin" : kind,
    };
  }

  /**
   * Make a release live. The release is named by id or by content digest, never
   * both, and the targets are `primary` (every primary origin) or the preview
   * URLs a pull-request build registers. `ttl` sets how
   * long each preview stays live and is only valid with preview URLs. The server
   * answers 201 when it wrote a deployment and 200 when every target already
   * served the release.
   *
   * @param input - The release, the targets and the optional guard.
   * @returns The deployment, new or the one the targets already served.
   * @throws ConflictError `409` (`dep.conflict`) when `expected_deployment_id` is no longer the newest.
   */
  async create(input: DeploymentInput): Promise<Deployment> {
    const record = await this.client.createDeployment(input, {
      project_id: this.projectId,
    });
    return Deployment.of(record);
  }

  /**
   * Re-apply a deployment: a new deployment with its release and its targets,
   * recorded as a rollback. Returns 200 when the targets already serve it.
   *
   * @param deploymentId - The deployment to re-apply.
   * @param options - A message, and the guard against a deploy that raced in.
   * @returns The deployment the rollback wrote, or the one already serving.
   * @throws ConflictError `409` (`dep.conflict`) when `expected_deployment_id` is no longer the newest.
   */
  async rollback(deploymentId: string, options: RollbackInput = {}): Promise<Deployment> {
    const record = await this.client.rollbackDeployment(
      deploymentId,
      {
        project_id: this.projectId,
      },
      options,
    );
    return Deployment.of(record);
  }

  /**
   * Make a release live on the primary origins, guarded against a deploy that
   * raced in: another deploy landing between reading what is live and writing.
   * The guard is the project's newest primary deployment, as the server
   * compares, so a live preview is never it. On a project's first deploy
   * nothing is live, so no guard is sent.
   *
   * @param request - The release and a message.
   * @returns Whether it deployed, lost a race, or met a revoked release.
   * @throws BackendError for any failure that is not one of those two outcomes.
   */
  async deployToPrimary(request: DeployToPrimaryRequest): Promise<DeployToPrimaryResult> {
    const observed = await this.newestPrimary();
    try {
      const deployment = await this.create({
        release_id: request.releaseId,
        targets: "primary",
        message: request.message,
        expected_deployment_id: observed?.id,
      });
      return {
        outcome: "deployed",
        deployment,
      };
    } catch (error) {
      if (!(error instanceof ConflictError)) {
        throw error;
      }
      if (error.serverCode === "rel.revoked") {
        return {
          outcome: "revoked",
        };
      }
      // The conflict is the answer; naming the deployment that won it is the
      // report. A read that fails here leaves the winner unnamed rather than
      // replacing a race the caller can act on with an error it cannot.
      //
      // The newest primary, not the newest to land on these origins: the guard
      // above asks what this deploy was replacing, while this asks what the
      // project serves now, which is what the caller is told and what it would
      // guard against on a retry.
      return {
        outcome: "raced",
        current: await this.newestPrimary().catch((cause: unknown): undefined => {
          // A cancellation is not a winner that could not be named: the person
          // asked the command to stop, and nothing was deployed to report.
          if (isCancelled(this.client)) {
            throw cause;
          }
          return undefined;
        }),
      };
    }
  }

  /**
   * Make what the primary origins run live on a primary origin added since the
   * newest primary deployment, which serves nothing until a deployment names
   * it: the newest primary release is deployed again, landing on that origin
   * too. Nothing is deployed when that deployment already names the origin, or
   * when the project has no primary deployment.
   *
   * @param origin - The primary origin to serve.
   * @param message - What the deployment records as its message.
   * @returns Whether it deployed, had nothing to do, lost a race, or met a
   *   revoked release.
   * @throws BackendError for any failure that is not one of those outcomes.
   */
  async extendPrimary(origin: string, message: string): Promise<ExtendPrimaryResult> {
    const newest = await this.newestPrimary();
    if (newest === undefined) {
      return { outcome: "none" };
    }
    if (newest.origins.includes(origin)) {
      return { outcome: "unchanged" };
    }
    return this.deployToPrimary({
      releaseId: newest.release_id,
      message,
    });
  }

  /**
   * Decide what a rollback re-applies. The whole primary history is read, not
   * the first page, because the prior deployment of a long-lived origin can sit
   * beyond it. Naming a deployment needs none of it and reads nothing.
   *
   * @param deploymentId - The deployment to re-apply, or omitted to undo the last deploy.
   * @returns The target, or why there is none.
   */
  async planRollback(deploymentId?: string): Promise<RollbackPlan> {
    if (deploymentId !== undefined) {
      return {
        outcome: "target",
        target: {
          id: deploymentId,
          expectedDeploymentId: undefined,
        },
      };
    }
    const all = await this.list();
    const [latest, prior] = all.filter((deployment) => {
      return deployment.servesPrimary;
    });
    if (latest === undefined) {
      return {
        outcome: "nothing-deployed",
      };
    }
    if (prior === undefined) {
      return {
        outcome: "nothing-earlier",
      };
    }
    return {
      outcome: "target",
      target: {
        id: prior.id,
        expectedDeploymentId: latest.id,
      },
    };
  }
}
