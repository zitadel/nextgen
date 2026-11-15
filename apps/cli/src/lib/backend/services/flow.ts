import type {
  PublishFlowDefinition201,
  PublishFlowDefinitionBody,
  GetFlowDefinition200,
  ListFlowDefinitions200,
  ListFlowDefinitionsParams,
} from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";
import { NotFoundError } from "@/lib/backend/errors";

/** What narrows and pages a list of flow definitions. */
export type FlowQuery = Readonly<Omit<ListFlowDefinitionsParams, "project_id">>;

/** A flow definition, as the list of them returns it. */
export type FlowSummary = ListFlowDefinitions200["flow_definitions"][number];

/** One page of flow definitions. */
export type FlowPage = Page<FlowSummary>;

/** A flow definition revision, as a read returns it. */
export type FlowRecord = GetFlowDefinition200;

/** What creating a flow definition takes: the schema it pins and the flow itself. */
export type FlowInput = Readonly<Omit<PublishFlowDefinitionBody, "project_id">>;

/** A flow definition revision as creation returns it. */
export type CreatedFlow = PublishFlowDefinition201;

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
   * List the flow definitions, across all pages.
   *
   * @param query - The filters the server narrows the list by.
   * @returns Every flow definition the filters leave.
   */
  async list(query: FlowQuery = {}): Promise<readonly FlowSummary[]> {
    return this.client.listFlowDefinitions.all({
      ...query,
      project_id: this.projectId,
    });
  }

  /**
   * List the flow definitions, a page at a time.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: FlowQuery = {}, options: PageOptions = {}): Promise<FlowPage> {
    const paging = new Paging(pagedFunctions.listFlowDefinitions);
    const pages = this.client.listFlowDefinitions.pages({
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
    const first = await this.page({
      name: reference,
      limit: 1,
    });
    const current = first.items[0];
    if (current === undefined) {
      throw new NotFoundError(`No flow definition named "${reference}"`, {
        hint: "Run `flow-definition list` to see the flows this project has.",
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
    return this.client.publishFlowDefinition({
      ...input,
      project_id: this.projectId,
    });
  }
}
