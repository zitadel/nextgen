import type {
  PublishSchema201,
  PublishSchemaBody,
  GetSchema200,
  ListSchemas200,
  ListSchemasParams,
} from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";
import { NotFoundError } from "@/lib/backend/errors";

/** What narrows and pages a list of schemas. */
export type SchemaQuery = Readonly<Omit<ListSchemasParams, "project_id">>;

/** A schema, as the list of them returns it. */
export type SchemaSummary = ListSchemas200["schemas"][number];

/** One page of schemas. */
export type SchemaPage = Page<SchemaSummary>;

/** A schema revision, as a read returns it. */
export type SchemaRecord = GetSchema200;

/** What creating a schema takes: the document. */
export type SchemaInput = Readonly<PublishSchemaBody>;

/** A schema revision as creation returns it. */
export type CreatedSchema = PublishSchema201;

/**
 * The user schemas of one project: listing them, reading one by revision id or
 * by object type, and creating one.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class SchemaService extends ApiService {
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
   * List the schemas, across all pages.
   *
   * @param query - The filters the server narrows the list by.
   * @returns Every schema the filters leave.
   */
  async list(query: SchemaQuery = {}): Promise<readonly SchemaSummary[]> {
    return this.client.listSchemas.all({
      ...query,
      project_id: this.projectId,
    });
  }

  /**
   * List the schemas, a page at a time.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: SchemaQuery = {}, options: PageOptions = {}): Promise<SchemaPage> {
    const paging = new Paging(pagedFunctions.listSchemas);
    const pages = this.client.listSchemas.pages({
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
   * Read one schema. A revision id names one immutable revision and fetches it
   * directly; an object type resolves to the current revision through the list.
   * A revision id is whatever the customer's `$id` says, so there is no shape
   * to test for: the id is fetched first, and a 404 reads as "that was an
   * object type". The API has no fetch-by-object-type route yet.
   *
   * @param reference - A revision id, or an object type.
   * @returns The schema revision.
   * @throws NotFoundError when neither names a schema.
   */
  async get(reference: string): Promise<SchemaRecord> {
    try {
      // Scoped like every other call of this service: a schema id is unique
      // within a project and not across them — the seeded default schema
      // carries the same `$id` in every project — so a credential that can see
      // more than one resolves it ambiguously without the project named.
      return await this.client.getSchema(reference, {
        project_id: this.projectId,
      });
    } catch (error) {
      // A 404 exactly, because this reads the failure as a statement about the
      // reference rather than about the schema: nothing holds that id, so the
      // reference must have been an object type. A schema the server says is
      // gone is not an object type, and the not-found class covers both.
      if (!(error instanceof NotFoundError) || error.status !== 404) {
        throw error;
      }
    }
    const first = await this.page({
      object_type: reference,
      revisions: "latest",
      limit: 1,
    });
    const current = first.items[0];
    if (current === undefined) {
      throw new NotFoundError(`No schema named "${reference}"`, {
        hint: "Run `schemas list` to see the object types this project has.",
      });
    }
    return current;
  }

  /**
   * Create a schema revision.
   *
   * @param input - The schema document.
   * @returns The revision that was created.
   */
  async create(input: SchemaInput): Promise<CreatedSchema> {
    return this.client.publishSchema(input, {
      project_id: this.projectId,
    });
  }
}
