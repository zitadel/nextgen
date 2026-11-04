import type {
  CreateFlowDefinition201,
  CreateFlowDefinitionBody,
  GetFlowDefinition200,
  ListFlowDefinitions200,
  ListFlowDefinitionsParams,
} from "@zitadel/api/generated/model";

import type { ZitadelClient } from "./client";
import { ApiService, type Page } from "./api-service";
import { NotFoundError } from "./errors";

/** What narrows and pages a list of flow definitions. */
export type FlowQuery = Readonly<Omit<ListFlowDefinitionsParams, "project_id">>;

/** One page of flow definitions. */
export type FlowPage = Page<ListFlowDefinitions200["flow_definitions"][number]>;

/** A flow definition revision, as a read returns it. */
export type FlowRecord = GetFlowDefinition200;

/** What creating a flow definition takes: the schema it pins and the flow itself. */
export type FlowInput = Readonly<Omit<CreateFlowDefinitionBody, "project_id">>;

/** A flow definition revision as creation returns it. */
export type CreatedFlow = CreateFlowDefinition201;

/**
 * The login flow definitions of one project: listing them, reading one by
 * revision id or by name, and creating one.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class FlowService extends ApiService {
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
   * List the flow definitions, a page at a time.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @returns One page of flow definitions.
   */
  async list(query: FlowQuery = {}): Promise<FlowPage> {
    const response = await this.client.listFlowDefinitions({
      ...query,
      project_id: this.projectId,
    });
    return Object.freeze({
      items: response.flow_definitions,
      next: response.next_page_token ?? null,
    });
  }

  /**
   * Read one flow definition. `flowdef_…` names one revision. Anything else is
   * a flow name, and the endpoint returns that flow's revisions newest first,
   * so the first row is the current one.
   *
   * @param reference - A revision id, or a flow name.
   * @returns The flow definition revision.
   * @throws NotFoundError when the name matches no flow.
   */
  async get(reference: string): Promise<FlowRecord> {
    if (reference.startsWith("flowdef_")) {
      return this.client.getFlowDefinition(reference);
    }
    const page = await this.list({
      name: reference,
      limit: 1,
    });
    const current = page.items[0];
    if (current === undefined) {
      throw new NotFoundError(`No flow definition named "${reference}"`, {
        hint: "Run `flow-definitions list` to see the flows this project has.",
      });
    }
    return current;
  }

  /**
   * Create a flow definition revision.
   *
   * @param input - The schema the flow pins and the flow itself.
   * @returns The revision that was created.
   */
  async create(input: FlowInput): Promise<CreatedFlow> {
    return this.client.createFlowDefinition({
      ...input,
      project_id: this.projectId,
    });
  }
}
