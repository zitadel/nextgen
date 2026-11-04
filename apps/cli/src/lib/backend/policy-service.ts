import type { ZitadelClient } from "../api-client";

/** What narrows and pages a list of policies. */
export type PolicyQuery = Readonly<
  Omit<Parameters<ZitadelClient["listPolicies"]>[0], "project_id">
>;

/** What {@link PolicyService.evaluate} runs a policy against. */
export type PolicyEvaluation = Readonly<Parameters<ZitadelClient["evaluatePolicy"]>[0]>;

/** One page of policies, each at its newest revision. */
export type PolicyPage = Awaited<ReturnType<ZitadelClient["listPolicies"]>>;

/** A policy, as the list of them returns it. */
export type PolicySummary = PolicyPage["policies"][number];

/** A policy, as a read returns it. */
export type PolicyRecord = Awaited<ReturnType<ZitadelClient["getPolicy"]>>;

/** One pinned revision of a policy. */
export type PolicyRevision = Awaited<ReturnType<ZitadelClient["getPolicyRevision"]>>;

/** What a policy decided about one input. */
export type PolicyDecision = Awaited<ReturnType<ZitadelClient["evaluatePolicy"]>>;

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
export class PolicyService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * List the policies, a page at a time.
   *
   * @param query - The filter, the page size and the cursor to continue from.
   * @returns One page of policies, each at its newest revision.
   */
  async list(query: PolicyQuery = {}): Promise<PolicyPage> {
    return this.client.listPolicies({
      ...query,
      project_id: this.projectId,
    });
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
  async ofOperation(
    operation: NonNullable<PolicyQuery["operation"]>,
  ): Promise<PolicySummary | undefined> {
    const page = await this.list({
      operation,
      limit: 1,
    });
    return page.policies[0];
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
