/**
 * MSW handlers for the Zitadel platform API used by the CLI.
 *
 * Covers (in sync with `api/openapi/openapi-spec.yaml` on main):
 *   - POST   /projects
 *   - GET    /projects/:id
 *   - POST   /schemas
 *   - GET    /schemas/:id
 *   - DELETE /schemas/:id           (CLI uses; spec-gap follow-up issue filed)
 *   - POST   /flow_definitions      (returns flow-definition-detail-response)
 *   - GET    /flow_definitions      (list)
 *   - GET    /flow_definitions/:id
 *   - PATCH  /flow_definitions/:id  (returns 200 + flow-definition-detail-response)
 *   - DELETE /flow_definitions/:id  (returns 204)
 *
 * Usage (Node / vitest):
 *
 *   import { setupServer } from 'msw/node';
 *   import { setupPlatformHandlers, resetPlatformStore } from '@zitadel-nextgen/api-mock/platform';
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
  UpdateFlowDefinition200,
} from "@zitadel-nextgen/api/generated/model";
import { http, HttpResponse } from "msw";

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Spec-defined error envelope. Matches `api/openapi/components/error-details.yaml`
 * and the structural shape of every per-endpoint `*Default`/`*4xx` error type
 * orval emits. Exported so callers can type their own error-payload variables
 * (e.g. `server.ts` uses this for the `/sessions/exchange` JSON-parse 400).
 */
export type ErrorBody = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Build an error body matching `api/openapi/components/error-details.yaml`:
 * `{ code, message, details? }`. Use everywhere we return a non-2xx status.
 */
export function errorBody(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * Safely read a JSON request body. Returns the parsed object on success,
 * `null` on parse failure or non-object payload. Handlers map `null` to a
 * 400 with `errorBody("invalid_json", ...)` so malformed requests never
 * surface as an opaque 500 from inside the runtime.
 */
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
 *
 * The wrapper fields (`id`, `project_id`, `schema_uri`, `status`, `created_at`,
 * `updated_at`) are owned by the mock and match the spec. The flow-definition
 * body is whatever the caller POSTed — the mock stores it verbatim and trusts
 * it to be a valid `flow-definition.yaml`. The `as unknown as` cast at the
 * boundary acknowledges that trust: the mock doesn't re-validate the body,
 * but the wrapper fields ARE typecheck-enforced.
 */
function flowDetailResponse(r: FlowDefinitionRecord): GetFlowDefinition200 {
  return {
    id: r.id,
    project_id: r.projectId,
    schema_uri: r.schemaUri,
    status: r.status,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    ...r.body,
  } as unknown as GetFlowDefinition200;
}

let store: Store = makeStore();

/** Reset all in-memory state between tests. */
export function resetPlatformStore(): void {
  store = makeStore();
}

export function setupPlatformHandlers() {
  return [
    // POST /projects
    http.post("*/projects", async ({ request }) => {
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = raw as { previewOrigins?: string[] };
      const id = `proj-${shortId()}`;
      const createdAt = nowIso();
      const project: ProjectRecord = {
        id,
        projectSecret: `sk_proj_${id.replace(/-/g, "")}_full`,
        previewSecret: `sk_proj_${id.replace(/-/g, "")}_preview`,
        previewOrigins: body.previewOrigins ?? [],
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

    // GET /projects/:id
    http.get("*/projects/:id", ({ params }) => {
      const project = store.projects.get(params.id as string);
      if (!project) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetProject200 = {
        id: project.id,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      return HttpResponse.json(responseBody);
    }),

    // POST /schemas
    //
    // Spec: `api/openapi/endpoints/schemas/methods.yaml` defines the request
    // as `oneOf [user-schema, schema-url]` keyed on the `kind` discriminator.
    // We accept either; anything else is 400 invalid_schema.
    http.post("*/schemas", async ({ request }) => {
      const body = await readJson(request);
      if (body === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const kind = body.kind;
      if (kind !== "user-schema" && kind !== "schema-url") {
        return HttpResponse.json(
          errorBody(
            "invalid_schema",
            'schema body must include kind: "user-schema" or "schema-url"',
          ),
          { status: 400 },
        );
      }
      const id = `schema_${shortId()}`;
      // The mock stores whatever the user POSTed and serves it back unchanged.
      // The cast acknowledges we trust the body; we don't re-validate it
      // against `user-schema.yaml` / `schema-url.yaml` schemas at runtime.
      store.schemas.set(id, body as unknown as GetSchemaById200);
      const responseBody: CreateSchema201 = { id };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    // GET /schemas/:id
    http.get("*/schemas/:id", ({ params }) => {
      const schema = store.schemas.get(params.id as string);
      if (!schema) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return HttpResponse.json(schema);
    }),

    // DELETE /schemas/:id
    //
    // Spec includes a 404 not-found response — callers must be able to
    // distinguish "deleted" from "id didn't exist". `Map.delete()`
    // returns `true` only when the key was present.
    http.delete("*/schemas/:id", ({ params }) => {
      const existed = store.schemas.delete(params.id as string);
      if (!existed) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),

    // POST /flow_definitions
    //
    // Spec: requestBody is the `flow-definition-create-request` envelope
    // (`{ project_id, schema_uri?, flow_definition }`). The mock validates
    // the envelope and 400s if `project_id` or `flow_definition` is missing,
    // matching the contract any real backend would enforce.
    http.post("*/flow_definitions", async ({ request }) => {
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const hasEnvelope =
        typeof raw.project_id === "string" &&
        typeof raw.flow_definition === "object" &&
        raw.flow_definition !== null;
      if (!hasEnvelope) {
        return HttpResponse.json(
          errorBody(
            "invalid_request",
            "POST /flow_definitions requires {project_id, flow_definition, schema_uri?} envelope",
          ),
          { status: 400 },
        );
      }

      const projectId = raw.project_id as string;
      const schemaUri = typeof raw.schema_uri === "string" ? raw.schema_uri : DEFAULT_SCHEMA_URI;
      const body = raw.flow_definition as Record<string, unknown>;

      const id = `flow_${shortId()}`;
      const now = nowIso();
      const record: FlowDefinitionRecord = {
        id,
        projectId,
        schemaUri,
        status: "active",
        createdAt: now,
        updatedAt: now,
        body,
      };
      store.flowDefinitions.set(id, record);
      const responseBody: CreateFlowDefinition201 = flowDetailResponse(record);
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    // GET /flow_definitions (list)
    //
    // Spec `flow-definition-list-response.yaml` defines an optional
    // `next_page_token` field that may be `null` when there is no next
    // page. The mock never paginates (in-memory store), so we always emit
    // explicit null — spec-strict consumers iterating with cursors can rely
    // on its presence to detect end-of-list rather than `undefined`.
    http.get("*/flow_definitions", () => {
      const responseBody: ListFlowDefinitions200 = {
        flow_definitions: Array.from(store.flowDefinitions.values()).map(flowDetailResponse),
        next_page_token: null,
      };
      return HttpResponse.json(responseBody);
    }),

    // GET /flow_definitions/:id
    http.get("*/flow_definitions/:id", ({ params }) => {
      const record = store.flowDefinitions.get(params.id as string);
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetFlowDefinition200 = flowDetailResponse(record);
      return HttpResponse.json(responseBody);
    }),

    // PATCH /flow_definitions/:id
    //
    // Spec: partial update — only supplied fields are replaced; arrays/objects
    // are replaced atomically when supplied. The mock merges top-level keys
    // shallowly (sufficient for the CLI's "send full body" pattern and good
    // enough for partial spec-correct patches). Returns 200 + detail response
    // per `flow-definition-detail-response`.
    http.patch("*/flow_definitions/:id", async ({ params, request }) => {
      const record = store.flowDefinitions.get(params.id as string);
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const patch = await readJson(request);
      if (patch === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      record.body = { ...record.body, ...patch };
      record.updatedAt = nowIso();
      const responseBody: UpdateFlowDefinition200 = flowDetailResponse(record);
      return HttpResponse.json(responseBody, { status: 200 });
    }),

    // DELETE /flow_definitions/:id
    //
    // Spec includes a 404 not-found response — callers must be able to
    // distinguish "deleted" from "id didn't exist". `Map.delete()`
    // returns `true` only when the key was present.
    http.delete("*/flow_definitions/:id", ({ params }) => {
      const existed = store.flowDefinitions.delete(params.id as string);
      if (!existed) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
