import type {
  CreateDeployment200,
  CreateDeployment201,
  ListDeployments200DeploymentsItem,
  RollbackDeployment200,
  RollbackDeployment201,
} from "@zitadel/api/generated/model";

import { Paging } from "@zitadel/api/runtime/paging";

import { pagedFunctions, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
import { toVariableRows, type VariableRow } from "../variables";

/**
 * A deployment, as create returns it: 200 when every target already served it,
 * 201 when it wrote a new one. The two shapes match.
 */
export type Deployment = CreateDeployment200 | CreateDeployment201;

/**
 * A rollback, as the server returns it: 201 when it wrote a new deployment, 200
 * when every target already served the target deployment and nothing changed.
 * Kept as the union — like {@link Deployment} — for fidelity to the API contract
 * rather than casting one arm away. The two bodies are structurally identical
 * and the client does not surface the status code, so a caller cannot yet tell a
 * no-op from a write; distinguishing them would need the status threaded through.
 */
export type RolledBackDeployment = RollbackDeployment200 | RollbackDeployment201;

/** What target a deploy goes to: every primary origin, or one exact origin. */
export type DeployTargets = ["primary"] | [string];

/** What {@link DeploymentService.deploy} publishes, and where. */
export type DeployInput = {
  releaseId?: string;
  contentHash?: string;
  targets: string[];
  message?: string;
  ttl?: string;
  /**
   * Optimistic-concurrency guard: the deployment the caller believes is the
   * newest one to the targets. The server answers 409 (`dep.conflict`) when
   * another deploy raced in, so nothing is overwritten unseen.
   */
  expectedDeploymentId?: string;
};

/** What {@link DeploymentService.rollback} may carry beyond the deployment it re-applies. */
export type RollbackOptions = {
  message?: string;
  /**
   * Optimistic-concurrency guard: the deployment the caller believes is the
   * newest one to the targets. The server answers 409 (`dep.conflict`) when
   * another deploy raced in between the caller reading state and this write,
   * so a rollback never overwrites a change the caller never saw.
   */
  expectedDeploymentId?: string;
};

/** A deployment as the server records it. */
export type DeploymentRecord = Awaited<ReturnType<ZitadelClient["getDeploymentById"]>>;

/**
 * A deployment with everything that belongs to it: the record, and the
 * variables it froze when it was made.
 */
export type DeploymentDetail = Readonly<{
  deployment: DeploymentRecord;
  variables: readonly VariableRow[];
}>;

/** One page of the deployment history, or every page when it was asked to drain. */
export type DeploymentHistory = Readonly<{
  items: readonly ListDeployments200DeploymentsItem[];
  /** The cursor to the next page, or null when none remains. */
  next: string | null;
}>;

/** What narrows a list of deployments. */
export type DeploymentQuery = Readonly<{ origin?: string; live?: boolean }>;

/** What narrows and pages a list of deployments. */
export type DeploymentPageQuery = DeploymentQuery &
  Readonly<{ limit?: number; page_token?: string; all?: boolean }>;

/**
 * The deployments of one project: making a release live, undoing that, and
 * reading what is live now.
 *
 * @remarks
 * A Service Layer (Fowler, Patterns of Enterprise Application Architecture) over the generated API client, which plays the Gateway: a command says what should happen and never which endpoint serves it. Bound to one project at construction, so a call carries only what is specific to it.
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
   * rollback undoes. Look for it across every page (`listDeployments.all`): one
   * live preview per open pull request can push it off the first.
   */
  static servesPrimary(deployment: Pick<ListDeployments200DeploymentsItem, "targets">): boolean {
    return deployment.targets.some((target) => target.expires_at == null);
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

  /** Read the deployment record alone, for a caller that needs nothing it froze. */
  async record(deploymentId: string): Promise<DeploymentRecord> {
    return this.client.getDeploymentById(deploymentId, { project_id: this.projectId });
  }

  /** The variables a deployment froze when it was made. A secret is named, never disclosed. */
  async frozenVariables(deploymentId: string): Promise<readonly VariableRow[]> {
    const frozen = await this.client.getDeploymentVariables(deploymentId, {
      project_id: this.projectId,
    });
    return toVariableRows(frozen);
  }

  /** Every deployment, across all pages, optionally narrowed to the live ones or one origin. */
  async list(query: DeploymentQuery = {}) {
    return this.client.listDeployments.all({ project_id: this.projectId, ...query });
  }

  /** The deployments serving traffic now, optionally for one origin. */
  async live(origin?: string) {
    return this.list({ live: true, origin });
  }

  /**
   * The deployment history, newest first.
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
        targets: input.targets,
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
   * Re-apply a deployment: a new deployment with its release and its targets,
   * recorded as a rollback. Returns 200 when the targets already serve it.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param deploymentId - The deployment to re-apply.
   * @param options - A message, and the guard against a deploy that raced in.
   */
  async rollback(
    consent: Consent,
    deploymentId: string,
    options?: RollbackOptions,
  ): Promise<RolledBackDeployment> {
    const body = {
      ...(options?.message === undefined ? {} : { message: options.message }),
      ...(options?.expectedDeploymentId === undefined
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
}
