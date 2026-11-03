import type {
  CreateDeployment200,
  CreateDeployment201,
  ListDeployments200DeploymentsItem,
  RollbackDeployment200,
  RollbackDeployment201,
} from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { Paging } from "@zitadel/api/runtime/paging";

import { pagedFunctions, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
import { Variable } from "./variable-service";

/**
 * A deployment, as create returns it: 200 when every target already served it,
 * 201 when it wrote a new one. The two shapes match.
 */
export type Deployment = CreateDeployment200 | CreateDeployment201;

/**
 * A rollback, as the server returns it: 201 when it wrote a new deployment, 200
 * when every target already served the target deployment and nothing changed.
 * Kept as the union, like {@link Deployment}, for fidelity to the API contract.
 * The two bodies are structurally identical and the client does not surface the
 * status code, so a caller cannot yet tell a no-op from a write.
 */
export type RolledBackDeployment = RollbackDeployment200 | RollbackDeployment201;

/** A deployment, as the list of them returns it. */
export type DeploymentSummary = ListDeployments200DeploymentsItem;

/** A deployment, as a read returns it. */
export type DeploymentRecord = Awaited<ReturnType<ZitadelClient["getDeploymentById"]>>;

/** A deployment with everything that belongs to it: the record, and the variables it froze. */
export type DeploymentDetail = Readonly<{
  deployment: DeploymentRecord;
  variables: readonly Variable[];
}>;

/** What target a deploy goes to: every primary origin, or one exact origin. */
export type DeployTargets = readonly ["primary"] | readonly [string];

/** What narrows a list of deployments. */
export type DeploymentQuery = Readonly<{
  origin?: string;
  live?: boolean;
  /** Also return the release each deployment serves. */
  expand?: ["release"];
}>;

/** What narrows and pages a list of deployments. */
export type DeploymentPageQuery = DeploymentQuery &
  Readonly<{
    limit?: number;
    page_token?: string;
    /** Drain every page instead of reading one. */
    all?: boolean;
  }>;

/** One page of the deployment history, or every page when it was asked to drain. */
export type DeploymentHistory = Readonly<{
  items: readonly DeploymentSummary[];
  /** The cursor to the next page, or null when none remains. */
  next: string | null;
}>;

/** What {@link DeploymentService.publish} makes live, and where it lands. */
export type PublishRequest = Readonly<{
  releaseId: string;
  /** The primary origins the deploy lands on, which decide the concurrency guard. */
  landing: readonly string[];
  message?: string;
}>;

/**
 * What publishing a release to the primary origins came to.
 *
 * `raced` means another deploy landed between reading what the origins serve
 * and writing, so nothing was overwritten; `current` is that deployment.
 * `revoked` means the release was revoked before it could be deployed, which
 * is not a race: trying again fails the same way.
 */
export type Publication = Readonly<
  | { outcome: "deployed"; deployment: Deployment }
  | { outcome: "raced"; current: DeploymentSummary | undefined }
  | { outcome: "revoked" }
>;

/** The deployment a rollback re-applies, and the one it expects to be live. */
export type RollbackTarget = Readonly<{
  id: string;
  expectedDeploymentId: string | undefined;
}>;

/**
 * What a rollback would re-apply, decided from the primary deployments: a
 * named deployment is taken as given, and a bare rollback undoes the newest.
 */
export type RollbackPlan = Readonly<
  | { outcome: "target"; target: RollbackTarget }
  | { outcome: "nothing-deployed" }
  | { outcome: "nothing-earlier" }
>;

/** What {@link DeploymentService.deploy} publishes, and where. */
export type DeployInput = Readonly<{
  releaseId?: string;
  contentHash?: string;
  targets: readonly string[];
  message?: string;
  ttl?: string;
  /**
   * Optimistic-concurrency guard: the deployment the caller believes is the
   * newest one to the targets. The server answers 409 (`dep.conflict`) when
   * another deploy raced in, so nothing is overwritten unseen.
   */
  expectedDeploymentId?: string;
}>;

/** What {@link DeploymentService.rollback} may carry beyond the deployment it re-applies. */
export type RollbackOptions = Readonly<{
  message?: string;
  /**
   * Optimistic-concurrency guard: the deployment the caller believes is the
   * newest one to the targets. The server answers 409 (`dep.conflict`) when
   * another deploy raced in between the caller reading state and this write,
   * so a rollback never overwrites a change the caller never saw.
   */
  expectedDeploymentId?: string;
}>;

/**
 * The deployments of one project: reading them, making a release live, and
 * undoing that.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 *
 * Whether a deployment serves a primary origin is a rule of the domain, not of
 * any command, so it is a static query beside the operations that need it.
 */
export class DeploymentService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * Whether a deployment serves a primary origin. A preview deployment's targets
   * carry an expiry; it is never the baseline, the guard or the thing a bare
   * rollback undoes. Look for it across every page: one live preview per open
   * pull request can push it off the first.
   *
   * @param deployment - The deployment to judge.
   * @returns True when at least one target never expires.
   */
  static servesPrimary(deployment: Pick<DeploymentSummary, "targets">): boolean {
    return deployment.targets.some((target) => target.expires_at == null);
  }

  /**
   * List the deployments, across all pages.
   *
   * @param query - The filters: live ones only, one origin, the release each serves.
   * @returns The deployments, newest first.
   */
  async list(query: DeploymentQuery = {}): Promise<readonly DeploymentSummary[]> {
    return this.client.listDeployments.all({ project_id: this.projectId, ...query });
  }

  /**
   * List the deployments serving traffic now.
   *
   * @param origin - Narrow to the deployment serving this origin.
   * @returns The live deployments.
   */
  async live(origin?: string): Promise<readonly DeploymentSummary[]> {
    return this.list({ live: true, origin });
  }

  /**
   * Find the newest deployment serving a primary origin. A live preview is
   * never it, even when it is the newest in the project.
   *
   * @returns The deployment, or undefined when nothing is deployed to a primary origin.
   */
  async newestPrimary(): Promise<DeploymentSummary | undefined> {
    return (await this.live()).find(DeploymentService.servesPrimary);
  }

  /**
   * List the deployment history, a page at a time.
   *
   * @param query - The filters, the page size, the cursor to continue from, and
   * `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: DeploymentPageQuery = {}): Promise<DeploymentHistory> {
    const { all, ...filter } = query;
    const paging = new Paging(pagedFunctions.listDeployments);
    const pages = this.client.listDeployments.pages({ project_id: this.projectId, ...filter });
    const { items, next } = await paging.collect(pages, { all: all === true });
    return Object.freeze({ items, next });
  }

  /**
   * Read one deployment with everything that belongs to it.
   *
   * @param deploymentId - The deployment to read.
   * @returns The record and the variables it froze, as rows ready to show.
   */
  async get(deploymentId: string): Promise<DeploymentDetail> {
    const [deployment, variables] = await Promise.all([
      this.record(deploymentId),
      this.frozenVariables(deploymentId),
    ]);
    return Object.freeze({ deployment, variables });
  }

  /**
   * Read the deployment record alone, for a caller that needs nothing it froze.
   *
   * @param deploymentId - The deployment to read.
   * @returns The record.
   */
  async record(deploymentId: string): Promise<DeploymentRecord> {
    return this.client.getDeploymentById(deploymentId, { project_id: this.projectId });
  }

  /**
   * Read the variables a deployment froze when it was made. A secret is named,
   * never disclosed.
   *
   * @param deploymentId - The deployment whose variables to read.
   * @returns The variables, sorted by name.
   */
  async frozenVariables(deploymentId: string): Promise<readonly Variable[]> {
    const frozen = await this.client.getDeploymentVariables(deploymentId, {
      project_id: this.projectId,
    });
    return Variable.fromValues(frozen);
  }

  /**
   * Make a release live. The release is named by id or by content digest, never
   * both, and the targets are `primary` (every primary origin), one exact primary
   * origin, or the preview URLs a pull-request build registers. `ttl` sets how
   * long each preview stays live and is only valid with preview URLs. The server
   * answers 201 when it wrote a deployment and 200 when every target already
   * served the release.
   *
   * @param input - The release, the targets and the optional guard.
   * @returns The deployment, new or the one the targets already served.
   * @throws ApiError `409` (`dep.conflict`) when `expectedDeploymentId` is no longer the newest.
   */
  async deploy(input: DeployInput): Promise<Deployment> {
    return this.client.createDeployment(
      {
        ...(input.releaseId === undefined ? {} : { release_id: input.releaseId }),
        ...(input.contentHash === undefined ? {} : { content_hash: input.contentHash }),
        targets: [...input.targets],
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.ttl === undefined ? {} : { ttl: input.ttl }),
        ...(input.expectedDeploymentId === undefined
          ? {}
          : { expected_deployment_id: input.expectedDeploymentId }),
      },
      { project_id: this.projectId },
    );
  }

  /**
   * Make a release live on the primary origins, guarded against a deploy that
   * raced in. The guard is the newest deployment to any origin this deploy
   * lands on, so a live preview, which never targets a primary, is never it. On
   * a project's first deploy nothing is live, so no guard is sent.
   *
   * @param request - The release, the origins it lands on and a message.
   * @returns Whether it deployed, lost a race, or met a revoked release.
   * @throws ApiError for any failure that is not one of those two outcomes.
   */
  async publish(request: PublishRequest): Promise<Publication> {
    const live = await this.live();
    const observed = live.find((deployment) =>
      deployment.targets.some((target) => request.landing.includes(target.origin)),
    )?.id;
    try {
      const deployment = await this.deploy({
        releaseId: request.releaseId,
        targets: ["primary"],
        message: request.message,
        ...(observed === undefined ? {} : { expectedDeploymentId: observed }),
      });
      return Object.freeze({ outcome: "deployed", deployment });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) {
        throw error;
      }
      if (DeploymentService.codeOf(error) === "rel.revoked") {
        return Object.freeze({ outcome: "revoked" });
      }
      return Object.freeze({ outcome: "raced", current: await this.newestPrimary() });
    }
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
      return Object.freeze({
        outcome: "target",
        target: Object.freeze({ id: deploymentId, expectedDeploymentId: undefined }),
      });
    }
    const [latest, prior] = (await this.list()).filter(DeploymentService.servesPrimary);
    if (latest === undefined) {
      return Object.freeze({ outcome: "nothing-deployed" });
    }
    if (prior === undefined) {
      return Object.freeze({ outcome: "nothing-earlier" });
    }
    return Object.freeze({
      outcome: "target",
      target: Object.freeze({ id: prior.id, expectedDeploymentId: latest.id }),
    });
  }

  /**
   * Re-apply a deployment: a new deployment with its release and its targets,
   * recorded as a rollback. Returns 200 when the targets already serve it.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param deploymentId - The deployment to re-apply.
   * @param options - A message, and the guard against a deploy that raced in.
   * @returns The deployment the rollback wrote, or the one already serving.
   * @throws ApiError `409` (`dep.conflict`) when `expectedDeploymentId` is no longer the newest.
   */
  async rollback(
    consent: Consent,
    deploymentId: string,
    options: RollbackOptions = {},
  ): Promise<RolledBackDeployment> {
    const body = {
      ...(options.message === undefined ? {} : { message: options.message }),
      ...(options.expectedDeploymentId === undefined
        ? {}
        : { expected_deployment_id: options.expectedDeploymentId }),
    };
    return consent
      .unlock(this.client)
      .rollbackDeployment(
        deploymentId,
        { project_id: this.projectId },
        Object.keys(body).length === 0 ? undefined : body,
      );
  }

  private static codeOf(error: ApiError): string | undefined {
    const body = error.body;
    return typeof body === "object" &&
      body !== null &&
      typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code
      : undefined;
  }
}
