import type { ZitadelClient } from "../api-client";

/** What narrows and pages a list of policies. */
export type PolicyQuery = Parameters<ZitadelClient["listPolicies"]>[0] extends infer Params
  ? Omit<Params, "project_id">
  : never;

/** What {@link PolicyService.evaluate} runs a policy against. */
export type PolicyEvaluation = Parameters<ZitadelClient["evaluatePolicy"]>[0];

/** The operation policies of one project. */
export class PolicyService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /** One page of policies, each at its newest revision. */
  async list(query: PolicyQuery = {}) {
    return this.client.listPolicies({ ...query, project_id: this.projectId });
  }

  /** Read one policy by its id. */
  async get(policyId: string) {
    return this.client.getPolicy(policyId, { project_id: this.projectId });
  }

  /** The policy of one operation, or undefined when the project has none. */
  async ofOperation(operation: NonNullable<PolicyQuery["operation"]>) {
    const page = await this.list({ operation, limit: 1 });
    return page.policies[0];
  }

  /** Read one pinned revision of a policy. */
  async revision(revisionId: string) {
    return this.client.getPolicyRevision(revisionId, { project_id: this.projectId });
  }

  /** Run a policy's config against one input and report what it decides. */
  async evaluate(evaluation: PolicyEvaluation) {
    return this.client.evaluatePolicy(evaluation, { project_id: this.projectId });
  }
}
