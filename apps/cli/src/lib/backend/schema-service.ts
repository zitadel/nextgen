import type {
  CreateSchema201,
  CreateSchemaBody,
  GetSchemaById200,
  ListSchemas200,
  ListSchemasParams,
} from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ZitadelClient } from "../gateway/client";
import { ZitadelError } from "../errors";

/** What narrows and pages a list of schemas. */
export type SchemaQuery = Readonly<Omit<ListSchemasParams, "project_id">>;

/** One page of schemas. */
export type SchemaPage = ListSchemas200;

/** A schema revision, as a read returns it. */
export type SchemaRecord = GetSchemaById200;

/** What creating a schema takes: the document. */
export type SchemaInput = Readonly<CreateSchemaBody>;

/** A schema revision as creation returns it. */
export type CreatedSchema = CreateSchema201;

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
export class SchemaService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * List the schemas, a page at a time.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @returns One page of schemas.
   */
  async list(query: SchemaQuery = {}): Promise<SchemaPage> {
    return this.client.listSchemas({
      ...query,
      project_id: this.projectId,
    });
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
   * @throws ZitadelError `E_NOT_FOUND` when neither names a schema.
   */
  async get(reference: string): Promise<SchemaRecord> {
    try {
      return await this.client.getSchemaById(reference);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
    }
    const page = await this.list({
      object_type: reference,
      revisions: "latest",
      limit: 1,
    });
    const current = page.schemas[0];
    if (current === undefined) {
      throw new ZitadelError("E_NOT_FOUND", `No schema named "${reference}"`, {
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
    return this.client.createSchema(input, {
      project_id: this.projectId,
    });
  }
}
