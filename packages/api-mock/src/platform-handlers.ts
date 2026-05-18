/**
 * MSW handlers for the Zitadel platform API used by the CLI.
 *
 * Covers (in sync with `api/openapi/openapi-spec.yaml` on main):
 *   - POST   /projects
 *   - GET    /projects/:id
 *   - POST   /projects/:id/claim/init   (CLI-only, no spec yet)
 *   - GET    /projects/:id/claim/status (CLI-only, no spec yet)
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

import { http, HttpResponse } from "msw";

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build an error body matching `api/openapi/components/error-details.yaml`:
 * `{ code, message, details? }`. Use everywhere we return a non-2xx status.
 */
export function errorBody(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): { code: string; message: string; details?: Record<string, unknown> } {
  return details === undefined ? { code, message } : { code, message, details };
}

type Project = {
  id: string;
  projectSecret: string;
  previewSecret: string;
  previewOrigins: string[];
  createdAt: string;
  updatedAt: string;
  challengeId?: string;
};

type ClaimState = "pending" | "claimed" | "expired";

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
  projects: Map<string, Project>;
  schemas: Map<string, object>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
  claimState: ClaimState;
};

function makeStore(): Store {
  return {
    projects: new Map(),
    schemas: new Map(),
    flowDefinitions: new Map(),
    claimState: "pending",
  };
}

const DEFAULT_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/components/flows/flow-definition.yaml";

/**
 * Build a `flow-definition-detail-response` envelope around a stored body, as
 * specified by `api/openapi/components/flows/flow-definition-detail-response.yaml`.
 */
function flowDetailResponse(r: FlowDefinitionRecord): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    schema_uri: r.schemaUri,
    status: r.status,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    ...r.body,
  };
}

let store: Store = makeStore();

/** Reset all in-memory state between tests. */
export function resetPlatformStore(): void {
  store = makeStore();
}

/** Advance the claim status to "claimed" — call this in tests that exercise the claim flow. */
export function completeMockClaim(): void {
  store.claimState = "claimed";
}

export function setupPlatformHandlers() {
  return [
    // POST /projects
    http.post("*/projects", async ({ request }) => {
      const body = (await request.json()) as { previewOrigins?: string[] };
      const id = `proj-${shortId()}`;
      const createdAt = nowIso();
      const project: Project = {
        id,
        projectSecret: `sk_proj_${id.replace(/-/g, "")}_full`,
        previewSecret: `sk_proj_${id.replace(/-/g, "")}_preview`,
        previewOrigins: body.previewOrigins ?? [],
        createdAt,
        updatedAt: createdAt,
      };
      store.projects.set(id, project);
      return HttpResponse.json(
        {
          id: project.id,
          projectSecret: project.projectSecret,
          previewSecret: project.previewSecret,
          previewOrigins: project.previewOrigins,
          createdAt: project.createdAt,
        },
        { status: 201 },
      );
    }),

    // GET /projects/:id
    http.get("*/projects/:id", ({ params }) => {
      const project = store.projects.get(params.id as string);
      if (!project) return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      return HttpResponse.json({
        id: project.id,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    }),

    // POST /projects/:id/claim/init
    http.post("*/projects/:id/claim/init", ({ params }) => {
      const projectId = params.id as string;
      const challengeId = `chal_${shortId()}`;
      const project = store.projects.get(projectId);
      if (project) project.challengeId = challengeId;
      return HttpResponse.json({
        claim_url: `https://zitadel.cloud/claim/${projectId}/${challengeId}`,
        challenge_id: challengeId,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    }),

    // GET /projects/:id/claim/status
    http.get("*/projects/:id/claim/status", ({ params }) => {
      const project = store.projects.get(params.id as string);
      if (store.claimState === "claimed") {
        return HttpResponse.json({
          status: "claimed",
          new_project_secret: `${project?.projectSecret ?? "sk"}_claimed`,
          team_id: "team_mock",
          claimed_at: nowIso(),
          dashboard_url: `https://zitadel.cloud/projects/${params.id as string}`,
          tier: "free",
        });
      }
      return HttpResponse.json({ status: store.claimState });
    }),

    // POST /schemas
    http.post("*/schemas", async ({ request }) => {
      const body = (await request.json()) as object;
      const id = `schema_${shortId()}`;
      store.schemas.set(id, body);
      return HttpResponse.json({ id }, { status: 201 });
    }),

    // GET /schemas/:id
    http.get("*/schemas/:id", ({ params }) => {
      const schema = store.schemas.get(params.id as string);
      if (!schema) return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      return HttpResponse.json(schema);
    }),

    // DELETE /schemas/:id
    http.delete("*/schemas/:id", ({ params }) => {
      store.schemas.delete(params.id as string);
      return new HttpResponse(null, { status: 204 });
    }),

    // POST /flow_definitions
    //
    // Spec: requestBody is the `flow-definition-create-request` envelope
    // (`{ project_id, schema_uri?, flow_definition }`). The mock validates
    // the envelope and 400s if `project_id` or `flow_definition` is missing,
    // matching the contract any real backend would enforce.
    http.post("*/flow_definitions", async ({ request }) => {
      const raw = (await request.json()) as Record<string, unknown>;
      const hasEnvelope =
        raw &&
        typeof raw === "object" &&
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
      return HttpResponse.json(flowDetailResponse(record), { status: 201 });
    }),

    // GET /flow_definitions (list)
    http.get("*/flow_definitions", () => {
      return HttpResponse.json({
        flow_definitions: Array.from(store.flowDefinitions.values()).map(flowDetailResponse),
      });
    }),

    // GET /flow_definitions/:id
    http.get("*/flow_definitions/:id", ({ params }) => {
      const record = store.flowDefinitions.get(params.id as string);
      if (!record) return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      return HttpResponse.json(flowDetailResponse(record));
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
      if (!record) return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      const patch = (await request.json()) as Record<string, unknown>;
      record.body = { ...record.body, ...patch };
      record.updatedAt = nowIso();
      return HttpResponse.json(flowDetailResponse(record), { status: 200 });
    }),

    // DELETE /flow_definitions/:id
    http.delete("*/flow_definitions/:id", ({ params }) => {
      store.flowDefinitions.delete(params.id as string);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
