/**
 * MSW handlers for the Zitadel platform API used by the CLI.
 *
 * Every mutating endpoint validates its request (path params, query
 * params, body) against the generated Zod schemas from
 * `@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod` — the
 * same source of truth the real server's OpenAPI spec generates. Every
 * read endpoint validates its response on the way out, so the mock
 * cannot lie about its own outputs. Wire-shape drift in either
 * direction fails fast in `vitest run` instead of surfacing only
 * against a live Zitadel.
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
  ApplyProjectConfig200,
  CompleteProjectClaim200,
  CreateFlowDefinition201,
  CreateProject201,
  CreateSchema201,
  GetProjectClaimStatus200,
  GetFlowDefinition200,
  GetProject200,
  GetSchemaById200,
  InitProjectClaim201,
  ListFlowDefinitions200,
  UpdateFlowDefinition200,
} from "@zitadel-nextgen/api/generated/model";
import {
  ApplyProjectConfigBody,
  ApplyProjectConfigParams,
  ApplyProjectConfigQueryParams,
  ApplyProjectConfigResponse,
  CompleteProjectClaimBody,
  CompleteProjectClaimParams,
  CompleteProjectClaimResponse,
  CreateFlowDefinitionBody,
  CreateProjectBody,
  CreateProjectHeader,
  CreateSchemaBody,
  CreateSchemaQueryParams,
  DeleteFlowDefinitionParams,
  GetFlowDefinitionParams,
  GetFlowDefinitionResponse,
  GetProjectClaimStatusParams,
  GetProjectClaimStatusQueryParams,
  GetProjectClaimStatusResponse,
  GetProjectParams,
  GetProjectResponse,
  GetSchemaByIdParams,
  GetSchemaByIdQueryParams,
  GetSchemaByIdResponse,
  InitProjectClaimBody,
  InitProjectClaimParams,
  ListFlowDefinitionsQueryParams,
  ListFlowDefinitionsResponse,
  UpdateFlowDefinitionBody,
  UpdateFlowDefinitionParams,
  UpdateFlowDefinitionResponse,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";
import { http, HttpResponse } from "msw";

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
type SafeParseSchema<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown } };
};

function parse<T>(
  schema: SafeParseSchema<T>,
  value: unknown,
  code: string,
): { ok: true; data: T } | { ok: false; response: HttpResponse<ErrorBody> } {
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
  project_id: string;
  project_secret: string;
  preview_secret: string;
  preview_origins: string[];
  lifecycle: "unclaimed" | "claimed";
  claim_required_for: Array<"preview" | "production">;
  team_id?: string;
  tier?: "free" | "pro" | "enterprise";
  created_at: string;
  updated_at: string;
  claimed_at?: string;
};

type ClaimChallengeRecord = {
  project_id: string;
  challenge_id: string;
  claim_url: string;
  expires_at: string;
  status: "pending" | "completed";
  initiating_secret: string;
  rotated_project_secret?: string;
  rotated_secret_consumed: boolean;
  claimed_at?: string;
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
  idempotency: Map<string, { requestHash: string; projectId: string }>;
  claimChallenges: Map<string, ClaimChallengeRecord>;
  schemas: Map<string, GetSchemaById200>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
};

function makeStore(): Store {
  return {
    projects: new Map(),
    idempotency: new Map(),
    claimChallenges: new Map(),
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

function createProjectResponse(project: ProjectRecord): CreateProject201 {
  return {
    project_id: project.project_id,
    project_secret: project.project_secret,
    preview_secret: project.preview_secret,
    preview_origins: project.preview_origins,
    lifecycle: project.lifecycle,
    claim_required_for: project.claim_required_for,
    created_at: project.created_at,
  };
}

function getProjectResponse(project: ProjectRecord): GetProject200 {
  return {
    project_id: project.project_id,
    lifecycle: project.lifecycle,
    preview_origins: project.preview_origins,
    claim_required_for: project.claim_required_for,
    team_id: project.team_id,
    tier: project.tier,
    created_at: project.created_at,
    updated_at: project.updated_at,
    claimed_at: project.claimed_at,
  };
}

function readBearer(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : undefined;
}

function projectSecretAuthError(request: Request, project: ProjectRecord): Response | undefined {
  if (readBearer(request) === project.project_secret) return undefined;
  return HttpResponse.json(errorBody("auth.unauthorized", "missing or invalid credentials"), {
    status: 401,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function setupPlatformHandlers() {
  return [
    http.post("*/projects", async ({ request }) => {
      const header = parse(
        CreateProjectHeader,
        { "Idempotency-Key": request.headers.get("Idempotency-Key") ?? undefined },
        "invalid_header",
      );
      if (!header.ok) {
        return header.response;
      }

      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateProjectBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const requestHash = JSON.stringify(body.data);
      const idempotencyKey = header.data["Idempotency-Key"];
      if (idempotencyKey) {
        const existing = store.idempotency.get(idempotencyKey);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return HttpResponse.json(
              errorBody(
                "proj.idempotency_conflict",
                "idempotency key was reused with a different request body",
              ),
              { status: 409 },
            );
          }
          const project = store.projects.get(existing.projectId);
          if (project) {
            return HttpResponse.json(createProjectResponse(project), { status: 201 });
          }
        }
      }

      const id = `proj_${shortId()}`;
      const createdAt = nowIso();
      const project: ProjectRecord = {
        project_id: id,
        project_secret: `sk_proj_${id.replaceAll("_", "")}_full`,
        preview_secret: `sk_proj_${id.replaceAll("_", "")}_preview`,
        preview_origins: body.data.preview_origins ?? [],
        lifecycle: "unclaimed",
        claim_required_for: ["preview", "production"],
        created_at: createdAt,
        updated_at: createdAt,
      };
      store.projects.set(id, project);
      if (idempotencyKey) {
        store.idempotency.set(idempotencyKey, { requestHash, projectId: id });
      }
      return HttpResponse.json(createProjectResponse(project), { status: 201 });
    }),

    http.get("*/projects/:project_id", ({ params, request }) => {
      const path = parse(GetProjectParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const authError = projectSecretAuthError(request, project);
      if (authError) return authError;

      const responseBody = getProjectResponse(project);
      const out = parse(GetProjectResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.patch("*/projects/:project_id/config", async ({ params, request }) => {
      const path = parse(ApplyProjectConfigParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(ApplyProjectConfigQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const authError = projectSecretAuthError(request, project);
      if (authError) return authError;

      const raw = await readJson(request);
      const body = parse(ApplyProjectConfigBody, raw ?? {}, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      if (query.data.environment !== "development" && project.lifecycle !== "claimed") {
        return HttpResponse.json(
          errorBody("proj.claim_required", "project must be claimed before this operation", {
            project_id: project.project_id,
            environment: query.data.environment,
          }),
          { status: 409 },
        );
      }
      const responseBody: ApplyProjectConfig200 = {
        project_id: project.project_id,
        environment: query.data.environment,
        lifecycle: project.lifecycle,
        applied_at: nowIso(),
      };
      const out = parse(ApplyProjectConfigResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.post("*/projects/:project_id/claim/init", async ({ params, request }) => {
      const path = parse(InitProjectClaimParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const authError = projectSecretAuthError(request, project);
      if (authError) return authError;
      if (project.lifecycle === "claimed") {
        return HttpResponse.json(errorBody("proj.already_claimed", "project is already claimed"), {
          status: 409,
        });
      }

      const raw = (await readJson(request)) ?? {};
      const body = parse(InitProjectClaimBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const challengeId = `claim_${shortId()}`;
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const claimUrl = `https://zitadel.cloud/claim?project_id=${encodeURIComponent(project.project_id)}&challenge_id=${encodeURIComponent(challengeId)}`;
      const challenge: ClaimChallengeRecord = {
        project_id: project.project_id,
        challenge_id: challengeId,
        claim_url: claimUrl,
        expires_at: expiresAt,
        status: "pending",
        initiating_secret: readBearer(request) ?? project.project_secret,
        rotated_secret_consumed: false,
      };
      store.claimChallenges.set(challengeId, challenge);
      const responseBody: InitProjectClaim201 = {
        project_id: challenge.project_id,
        challenge_id: challenge.challenge_id,
        claim_url: challenge.claim_url,
        expires_at: challenge.expires_at,
        status: "pending",
      };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.post("*/projects/:project_id/claim/complete", async ({ params, request }) => {
      const path = parse(CompleteProjectClaimParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CompleteProjectClaimBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const challenge = store.claimChallenges.get(body.data.challenge_id);
      if (!challenge || challenge.project_id !== project.project_id) {
        return HttpResponse.json(errorBody("proj.claim_not_found", "claim challenge not found"), {
          status: 404,
        });
      }
      if (project.lifecycle === "claimed") {
        return HttpResponse.json(errorBody("proj.already_claimed", "project is already claimed"), {
          status: 409,
        });
      }
      if (Date.parse(challenge.expires_at) < Date.now()) {
        return HttpResponse.json(errorBody("proj.claim_expired", "claim challenge expired"), {
          status: 410,
        });
      }

      const teamChoice = isRecord(body.data.team_choice) ? body.data.team_choice : {};
      const claimedAt = nowIso();
      const teamId =
        typeof teamChoice.team_id === "string" ? teamChoice.team_id : `team_${shortId()}`;
      const rotatedProjectSecret = `sk_proj_${project.project_id.replaceAll("_", "")}_claimed`;
      project.lifecycle = "claimed";
      project.claim_required_for = [];
      project.team_id = teamId;
      project.tier = "free";
      project.claimed_at = claimedAt;
      project.updated_at = claimedAt;
      project.project_secret = rotatedProjectSecret;
      challenge.status = "completed";
      challenge.claimed_at = claimedAt;
      challenge.rotated_project_secret = rotatedProjectSecret;

      const responseBody: CompleteProjectClaim200 = {
        project_id: project.project_id,
        lifecycle: "claimed",
        team_id: teamId,
        tier: "free",
        claimed_at: claimedAt,
      };
      const out = parse(CompleteProjectClaimResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.get("*/projects/:project_id/claim/status", ({ params, request }) => {
      const path = parse(GetProjectClaimStatusParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(
        GetProjectClaimStatusQueryParams,
        queryRecord(request),
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const challenge = store.claimChallenges.get(query.data.challenge_id);
      if (!challenge || challenge.project_id !== project.project_id) {
        return HttpResponse.json(errorBody("proj.claim_not_found", "claim challenge not found"), {
          status: 404,
        });
      }
      if (readBearer(request) !== challenge.initiating_secret) {
        return HttpResponse.json(errorBody("auth.unauthorized", "missing or invalid credentials"), {
          status: 401,
        });
      }
      if (challenge.status === "pending" && Date.parse(challenge.expires_at) < Date.now()) {
        return HttpResponse.json(errorBody("proj.claim_expired", "claim challenge expired"), {
          status: 410,
        });
      }

      const responseBody: GetProjectClaimStatus200 = {
        project_id: challenge.project_id,
        challenge_id: challenge.challenge_id,
        status: challenge.status,
        expires_at: challenge.expires_at,
        claimed_at: challenge.claimed_at,
      };
      if (challenge.status === "completed") {
        if (challenge.rotated_secret_consumed || !challenge.rotated_project_secret) {
          return HttpResponse.json(
            errorBody("proj.secret_consumed", "rotated project secret was already retrieved"),
            { status: 410 },
          );
        }
        responseBody.rotated_project_secret = challenge.rotated_project_secret;
        challenge.rotated_secret_consumed = true;
      }

      const out = parse(GetProjectClaimStatusResponse, responseBody, "mock_response_invalid");
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
      const record: FlowDefinitionRecord = {
        id,
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
        flow_definitions: [...store.flowDefinitions.values()].map(flowDetailResponse),
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

    http.patch("*/flow_definitions/:id", async ({ params, request }) => {
      const path = parse(UpdateFlowDefinitionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }

      const record = store.flowDefinitions.get(path.data.id);
      if (!record) {
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

      record.body = { ...record.body, ...(body.data as unknown as Record<string, unknown>) };
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
