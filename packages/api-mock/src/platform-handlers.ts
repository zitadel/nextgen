/**
 * MSW handlers for the Zitadel platform API used by the CLI.
 *
 * Every mutating endpoint validates its request (path params, query
 * params, body) against the generated Zod schemas from
 * `@zitadel/api/generated/endpoints/zitadelNextGen.zod` — the
 * same source of truth the real server's OpenAPI spec generates. Every
 * read endpoint validates its response on the way out, so the mock
 * cannot lie about its own outputs. Wire-shape drift in either
 * direction fails fast in `vitest run` instead of surfacing only
 * against a live Zitadel.
 *
 * Usage (Node / vitest):
 *
 *   import { setupServer } from 'msw/node';
 *   import { setupPlatformHandlers, resetPlatformStore } from '@zitadel/api-mock/platform';
 *
 *   const server = setupServer(...setupPlatformHandlers());
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
 *   afterAll(() => server.close());
 *   afterEach(() => { server.resetHandlers(); resetPlatformStore(); });
 */
import { randomUUID } from "node:crypto";

import type {
  CreateFlowDefinition201,
  CreateProject201,
  CreateSchema201,
  GetFlowDefinition200,
  GetProject200,
  GetSchemaById200,
  ListFlowDefinitions200,
  ListFlowDefinitions200FlowDefinitionsItem,
  UpdateFlowDefinition200,
} from "@zitadel/api/generated/model";
import {
  CreateFlowDefinitionBody,
  CreateProjectBody,
  CreateSchemaBody,
  CreateSchemaQueryParams,
  DeleteFlowDefinitionParams,
  GetFlowDefinitionParams,
  GetFlowDefinitionResponse,
  GetProjectParams,
  GetProjectResponse,
  GetSchemaByIdParams,
  GetSchemaByIdQueryParams,
  GetSchemaByIdResponse,
  ListFlowDefinitionsQueryParams,
  ListFlowDefinitionsResponse,
  UpdateFlowDefinitionBody,
  UpdateFlowDefinitionParams,
  UpdateFlowDefinitionQueryParams,
  UpdateFlowDefinitionResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { http, HttpResponse } from "msw";
import type { z } from "zod";

function shortId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Spec-defined error envelope. Matches `api/openapi/components/error-details.yaml`
 * and the structural shape of every per-endpoint `*Default`/`*4xx` error type
 * orval emits.
 */
export type ErrorBody = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export function errorBody(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return details === undefined ? { code, message } : { code, message, details };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const INVALID_JSON = errorBody("invalid_json", "request body must be valid JSON");

/**
 * Run `safeParse` against the generated Zod and return either the
 * parsed (and defaulted) value or a 400 `HttpResponse` carrying the
 * Zod issue list. The discriminant key (`ok`) lets the caller short-
 * circuit cleanly. One pattern, used uniformly for path params, query
 * params, request bodies, and responses-on-the-way-out.
 */
function parse<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  code: string,
): { ok: true; data: z.output<S> } | { ok: false; response: HttpResponse<ErrorBody> } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    response: HttpResponse.json(
      errorBody(code, "request does not conform to spec", {
        issues: result.error.issues,
      }),
      { status: 400 },
    ),
  };
}

/** Build a query-string record msw can hand to the generated `QueryParams` zod. */
function queryRecord(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/**
 * Server-side record for a project. Strict superset of the spec response
 * types (`CreateProject201`, `GetProject200`): includes the server-only
 * secrets and `updatedAt`. Handlers project from this record to the right
 * wire shape at the boundary.
 */
type ProjectRecord = {
  id: string;
  projectSecret: string;
  previewSecret: string;
  previewOrigins: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Server-side metadata wrapped around the flow body so the mock can answer
 * `flow-definition-detail-response` per the OpenAPI contract.
 */
type FlowDefinitionRecord = {
  id: string;
  name: string;
  projectId: string;
  schemaUri: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  body: Record<string, unknown>;
};

type Store = {
  projects: Map<string, ProjectRecord>;
  schemas: Map<string, GetSchemaById200>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
};

function makeStore(): Store {
  return {
    projects: new Map(),
    schemas: new Map(),
    flowDefinitions: new Map(),
  };
}

const DEFAULT_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/components/flows/flow-definition.yaml";

/**
 * Build a `flow-definition-detail-response` envelope around a stored body, as
 * specified by `api/openapi/components/flows/flow-definition-detail-response.yaml`.
 */
function flowDetailResponse(r: FlowDefinitionRecord): GetFlowDefinition200 {
  return {
    id: r.id,
    project_id: r.projectId,
    schema_uri: r.schemaUri,
    status: r.status,
    flow_definition: r.body as unknown as GetFlowDefinition200['flow_definition'],
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  } as unknown as GetFlowDefinition200;
}

function flowListItemResponse(r: FlowDefinitionRecord): ListFlowDefinitions200FlowDefinitionsItem {
  return {
    id: r.id,
    name: r.name,
    project_id: r.projectId,
    schema_uri: r.schemaUri,
    status: r.status,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

let store: Store = makeStore();

/** Reset all in-memory state between tests. */
export function resetPlatformStore(): void {
  store = makeStore();
}

export function setupPlatformHandlers() {
  return [
    http.post("*/projects", async ({ request }) => {
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateProjectBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const id = `proj-${shortId()}`;
      const createdAt = nowIso();
      const project: ProjectRecord = {
        id,
        projectSecret: `sk_proj_${id.replaceAll("-", "")}_full`,
        previewSecret: `sk_proj_${id.replaceAll("-", "")}_preview`,
        previewOrigins: body.data.previewOrigins ?? [],
        createdAt,
        updatedAt: createdAt,
      };
      store.projects.set(id, project);
      const responseBody: CreateProject201 = {
        id: project.id,
        projectSecret: project.projectSecret,
        previewSecret: project.previewSecret,
        previewOrigins: project.previewOrigins,
        createdAt: project.createdAt,
      };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/projects/:project_id", ({ params }) => {
      const path = parse(GetProjectParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetProject200 = {
        id: project.id,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      const out = parse(GetProjectResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.post("*/schemas", async ({ request }) => {
      const query = parse(CreateSchemaQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateSchemaBody, raw, "invalid_schema");
      if (!body.ok) {
        return body.response;
      }

      const id = `schema_${shortId()}`;
      store.schemas.set(id, body.data as unknown as GetSchemaById200);
      const responseBody: CreateSchema201 = { id };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/schemas/:id", ({ params, request }) => {
      const path = parse(GetSchemaByIdParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetSchemaByIdQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const schema = store.schemas.get(path.data.id);
      if (!schema) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const out = parse(GetSchemaByIdResponse, schema, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.delete("*/schemas/:id", ({ params, request }) => {
      const path = parse(GetSchemaByIdParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetSchemaByIdQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const existed = store.schemas.delete(path.data.id);
      if (!existed) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),

    http.post("*/flow_definitions", async ({ request }) => {
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateFlowDefinitionBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const id = `flow_${shortId()}`;
      const now = nowIso();
      const flowDef = body.data.flow_definition as Record<string, unknown>;
      const record: FlowDefinitionRecord = {
        id,
        name: flowDef.name as string,
        projectId: body.data.project_id,
        schemaUri: body.data.schema_uri ?? DEFAULT_SCHEMA_URI,
        status: "active",
        createdAt: now,
        updatedAt: now,
        body: body.data.flow_definition as unknown as Record<string, unknown>,
      };
      store.flowDefinitions.set(id, record);
      const responseBody: CreateFlowDefinition201 = flowDetailResponse(record);
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/flow_definitions", ({ request }) => {
      const query = parse(
        ListFlowDefinitionsQueryParams,
        queryRecord(request),
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }

      const responseBody: ListFlowDefinitions200 = {
        flow_definitions: [...store.flowDefinitions.values()].map(flowListItemResponse),
        next_page_token: null,
      };
      const out = parse(ListFlowDefinitionsResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.get("*/flow_definitions/:id", ({ params }) => {
      const path = parse(GetFlowDefinitionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const record = store.flowDefinitions.get(path.data.id);
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetFlowDefinition200 = flowDetailResponse(record);
      const out = parse(GetFlowDefinitionResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.put("*/flow_definitions/:id", async ({ params, request }) => {
      const path = parse(UpdateFlowDefinitionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(UpdateFlowDefinitionQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const record = store.flowDefinitions.get(path.data.id);
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      if (record.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(UpdateFlowDefinitionBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const flowDef = body.data.flow_definition as unknown as Record<string, unknown>;
      record.name = flowDef.name as string;
      record.schemaUri = body.data.schema_uri ?? record.schemaUri;
      record.status = typeof flowDef.status === "string" ? flowDef.status : record.status;
      record.body = flowDef;
      record.updatedAt = nowIso();
      const responseBody: UpdateFlowDefinition200 = flowDetailResponse(record);
      const out = parse(UpdateFlowDefinitionResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: 200 });
    }),

    http.delete("*/flow_definitions/:id", ({ params }) => {
      const path = parse(DeleteFlowDefinitionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const existed = store.flowDefinitions.delete(path.data.id);
      if (!existed) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
