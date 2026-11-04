import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { Paging } from "@zitadel/api/runtime/paging";

import { pagedFunctions, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
import { Variable } from "./variable-service";

/** A deployment as the API reports it. */
type DeploymentWire = ListDeployments200DeploymentsItem;

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
  readonly targets: DeploymentWire["targets"];
  readonly deployed_at: string;
  readonly metadata: DeploymentWire["metadata"];
  declare readonly release?: DeploymentWire["release"];
  private readonly wire: DeploymentWire;

  private constructor(wire: DeploymentWire) {
    this.id = wire.id;
    this.release_id = wire.release_id;
    this.targets = wire.targets;
    this.deployed_at = wire.deployed_at;
    this.metadata = wire.metadata;
    if (wire.release !== undefined) {
      this.release = wire.release;
    }
    this.wire = wire;
    Object.freeze(this);
  }

  /**
   * Wrap a deployment the API reported.
   *
   * @param wire - The record as the API sent it.
   * @returns The deployment.
   */
  static of(wire: DeploymentWire): Deployment {
    return new Deployment(wire);
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
   * Whether this deployment serves a primary origin. A preview deployment's
   * targets carry an expiry; it is never the baseline, the guard or the thing a
   * bare rollback undoes.
   *
   * @returns True when at least one target never expires.
   */
  get servesPrimary(): boolean {
    return this.targets.some((target) => {
      return target.expires_at == null;
    });
  }

  /**
   * Why this deployment was made: a deploy, a rollback, a preview.
   *
   * @returns The reason the API recorded, when it recorded one.
   */
  get reason(): string | undefined {
    return this.metadata.reason;
  }

  /**
   * The record the API sent, which is what the JSON output carries.
   *
   * @returns The record.
   */
  toJSON(): DeploymentWire {
    return this.wire;
  }
}

/** What target a deploy goes to: every primary origin, or one exact origin. */
export type DeployTargets = readonly ["primary"] | readonly [string];

/** A deployment with everything that belongs to it: the record, and the variables it froze. */
export type DeploymentDetail = Readonly<{
  deployment: Deployment;
  variables: readonly Variable[];
}>;

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
  items: readonly Deployment[];
  /** The cursor to the next page, or null when none remains. */
  next: string | null;
}>;

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
 * The deployments of one project: reading them, making a release live, and
 * undoing that.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class DeploymentService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * List the deployments, across all pages.
   *
   * @param query - The filters: live ones only, one origin, the release each serves.
   * @returns The deployments, newest first.
   */
  async list(query: DeploymentQuery = {}): Promise<readonly Deployment[]> {
    const wires = await this.client.listDeployments.all({
      project_id: this.projectId,
      ...query,
    });
    return wires.map((wire) => {
      return Deployment.of(wire);
    });
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
   * Find the newest deployment serving a primary origin. A live preview is
   * never it, even when it is the newest in the project.
   *
   * @returns The deployment, or undefined when nothing is deployed to a primary origin.
   */
  async newestPrimary(): Promise<Deployment | undefined> {
    const live = await this.live();
    return live.find((deployment) => {
      return deployment.servesPrimary;
    });
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
    const pages = this.client.listDeployments.pages({
      project_id: this.projectId,
      ...filter,
    });
    const { items, next } = await paging.collect(pages, {
      all: all === true,
    });
    return Object.freeze({
      items: items.map((wire) => {
        return Deployment.of(wire);
      }),
      next,
    });
  }

  /**
   * Read one deployment with everything that belongs to it.
   *
   * @param deploymentId - The deployment to read.
   * @returns The deployment, and the variables it froze when it was made. A
   * secret is named, never disclosed.
   */
  async get(deploymentId: string): Promise<DeploymentDetail> {
    const wire = await this.client.getDeploymentById(deploymentId, {
      project_id: this.projectId,
    });
    const frozen = await this.client.getDeploymentVariables(deploymentId, {
      project_id: this.projectId,
    });
    return Object.freeze({
      deployment: Deployment.of(wire),
      variables: Variable.fromValues(frozen),
    });
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
    const wire = await this.client.createDeployment(
      {
        ...(input.releaseId === undefined
          ? {}
          : {
              release_id: input.releaseId,
            }),
        ...(input.contentHash === undefined
          ? {}
          : {
              content_hash: input.contentHash,
            }),
        targets: [...input.targets],
        ...(input.message === undefined
          ? {}
          : {
              message: input.message,
            }),
        ...(input.ttl === undefined
          ? {}
          : {
              ttl: input.ttl,
            }),
        ...(input.expectedDeploymentId === undefined
          ? {}
          : {
              expected_deployment_id: input.expectedDeploymentId,
            }),
      },
      {
        project_id: this.projectId,
      },
    );
    return Deployment.of(wire);
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
    const observed = live.find((deployment) => {
      return deployment.origins.some((origin) => {
        return request.landing.includes(origin);
      });
    });
    try {
      const deployment = await this.deploy({
        releaseId: request.releaseId,
        targets: ["primary"],
        message: request.message,
        ...(observed === undefined
          ? {}
          : {
              expectedDeploymentId: observed.id,
            }),
      });
      return Object.freeze({
        outcome: "deployed",
        deployment,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) {
        throw error;
      }
      if (DeploymentService.codeOf(error) === "rel.revoked") {
        return Object.freeze({
          outcome: "revoked",
        });
      }
      return Object.freeze({
        outcome: "raced",
        current: await this.newestPrimary(),
      });
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
        target: Object.freeze({
          id: deploymentId,
          expectedDeploymentId: undefined,
        }),
      });
    }
    const all = await this.list();
    const [latest, prior] = all.filter((deployment) => {
      return deployment.servesPrimary;
    });
    if (latest === undefined) {
      return Object.freeze({
        outcome: "nothing-deployed",
      });
    }
    if (prior === undefined) {
      return Object.freeze({
        outcome: "nothing-earlier",
      });
    }
    return Object.freeze({
      outcome: "target",
      target: Object.freeze({
        id: prior.id,
        expectedDeploymentId: latest.id,
      }),
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
  ): Promise<Deployment> {
    const body = {
      ...(options.message === undefined
        ? {}
        : {
            message: options.message,
          }),
      ...(options.expectedDeploymentId === undefined
        ? {}
        : {
            expected_deployment_id: options.expectedDeploymentId,
          }),
    };
    const wire = await consent.unlock(this.client).rollbackDeployment(
      deploymentId,
      {
        project_id: this.projectId,
      },
      Object.keys(body).length === 0 ? undefined : body,
    );
    return Deployment.of(wire);
  }

  private static codeOf(error: ApiError): string | undefined {
    const body = error.body;
    if (typeof body !== "object" || body === null) {
      return undefined;
    }
    const code = (
      body as {
        code?: unknown;
      }
    ).code;
    return typeof code === "string" ? code : undefined;
  }
}
