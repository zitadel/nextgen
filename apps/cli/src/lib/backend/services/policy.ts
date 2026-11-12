import type {
  EvaluatePolicy200,
  EvaluatePolicyBody,
  GetPolicy200,
  GetPolicyRevision200,
  ListPolicies200PoliciesItem,
  ListPoliciesParams,
  PublishPolicy201,
  PublishPolicyBody,
} from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";

/** What narrows and pages a list of policies. */
export type PolicyQuery = Readonly<Omit<ListPoliciesParams, "project_id">>;

/** One page of policies, each at its newest revision. */
export type PolicyPage = Page<Policy>;

/** A policy, as the list of them returns it. */
export type Policy = ListPolicies200PoliciesItem;

/** A policy, as a read returns it. */
export type PolicyRecord = GetPolicy200;

/** One pinned revision of a policy. */
export type PolicyRevision = GetPolicyRevision200;

/** What a policy is run against: the operation, the config and the input. */
export type PolicyEvaluation = Readonly<EvaluatePolicyBody>;

/** What a policy decided about one input. */
export type PolicyDecision = EvaluatePolicy200;

/** What publishing a policy takes: the operation and its config. */
export type PolicyInput = Readonly<PublishPolicyBody>;

/** A policy revision as publishing returns it. */
export type PublishedPolicy = PublishPolicy201;

/**
 * The operation policies of one project: reading them and evaluating a policy
 * against an input.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class PolicyService extends ApiService {
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
   * List the policies, across all pages.
   *
   * @param query - The filter the server narrows the list by.
   * @returns Every policy the filter leaves, each at its newest revision.
   */
  async list(query: PolicyQuery = {}): Promise<readonly Policy[]> {
    return this.client.listPolicies.all({
      ...query,
      project_id: this.projectId,
    });
  }

  /**
   * List the policies, a page at a time.
   *
   * @param query - The filter, the page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: PolicyQuery = {}, options: PageOptions = {}): Promise<PolicyPage> {
    const paging = new Paging(pagedFunctions.listPolicies);
    const pages = this.client.listPolicies.pages({
      ...query,
      project_id: this.projectId,
    });
    const collected = await paging.collect(pages, {
      all: options.all === true,
    });
    return {
      items: collected.items,
      next: collected.next,
    };
  }

  /**
   * Read one policy.
   *
   * @param policyId - The policy to read.
   * @returns The policy.
   */
  async get(policyId: string): Promise<PolicyRecord> {
    return this.client.getPolicy(policyId, {
      project_id: this.projectId,
    });
  }

  /**
   * Find the policy of one operation.
   *
   * @param operation - The operation whose policy to find.
   * @returns The policy, or undefined when the project has none for it.
   */
  async ofOperation(operation: NonNullable<PolicyQuery["operation"]>): Promise<Policy | undefined> {
    const first = await this.page({
      operation,
      limit: 1,
    });
    return first.items[0];
  }

  /**
   * Read one pinned revision of a policy.
   *
   * @param revisionId - The revision to read.
   * @returns The revision.
   */
  async revision(revisionId: string): Promise<PolicyRevision> {
    return this.client.getPolicyRevision(revisionId, {
      project_id: this.projectId,
    });
  }

  /**
   * Publish a policy: a new revision of the operation's policy.
   *
   * @param input - The operation and its config.
   * @returns The revision that was published.
   */
  async publish(input: PolicyInput): Promise<PublishedPolicy> {
    return this.client.publishPolicy(input, {
      project_id: this.projectId,
    });
  }

  /**
   * Run a policy's config against one input.
   *
   * @param evaluation - The operation, the config to run and the input.
   * @returns What the policy decided.
   */
  async evaluate(evaluation: PolicyEvaluation): Promise<PolicyDecision> {
    return this.client.evaluatePolicy(evaluation, {
      project_id: this.projectId,
    });
  }
}
