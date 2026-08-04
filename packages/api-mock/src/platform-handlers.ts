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
import { randomBytes, randomUUID } from "node:crypto";

import type {
  CompleteClaim200,
  CreateFlowDefinition201,
  CreateProject201,
  CreateSchema201,
  GetClaimStatus200,
  GetFlowDefinition200,
  GetProject200,
  GetSchemaById200,
  InitClaim201,
  ListFlowDefinitions200,
  ListFlowDefinitions200FlowDefinitionsItem,
  UpdateFlowDefinition200,
} from "@zitadel/api/generated/model";
import {
  CompleteClaimResponse,
  CreateFlowDefinitionBody,
  CreateProjectBody,
  CreateSchemaBody,
  CreateSchemaQueryParams,
  DeleteFlowDefinitionParams,
  GetClaimStatusParams,
  GetClaimStatusQueryParams,
  GetClaimStatusResponse,
  GetFlowDefinitionParams,
  GetFlowDefinitionResponse,
  GetProjectParams,
  GetProjectResponse,
  GetSchemaByIdParams,
  GetSchemaByIdQueryParams,
  InitClaimParams,
  ListFlowDefinitionsQueryParams,
  ListFlowDefinitionsResponse,
  ListUsersQueryParams,
  UpdateFlowDefinitionBody,
  UpdateFlowDefinitionParams,
  UpdateFlowDefinitionQueryParams,
  UpdateFlowDefinitionResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { validateFlowDefinition } from "@zitadel/config/validate";
import {
  DEFAULT_FLOW_SCHEMA_URI,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
} from "@zitadel/config/defaults";
import { http, HttpResponse } from "msw";
import type { z } from "zod";

function shortId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

// Claim challenge id. Matches the `ch_`-prefixed opaque contract in
// `components/schemas/challenge-id.yaml` and mints the 128 bits of
// cryptographic randomness ADR 046 requires, since this value authorizes
// a project claim from the browser.
function challengeId(): string {
  return `ch_${randomBytes(16).toString("base64url")}`;
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
  name: string;
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

/**
 * Server-side metadata wrapped around the schema body so the mock can answer
 * `POST /schemas` (returns id), `GET /schemas/:id` (returns body), and
 * `GET /schemas` (list — id + createdAt, filterable by object_type).
 */
type SchemaRecord = {
  id: string;
  projectId: string;
  objectType?: string;
  createdAt: string;
  body: GetSchemaById200;
};

/**
 * The ephemeral claim challenge (ADR 046): minted by `claim/init`, polled by
 * `claim/status`, and spent by `claim/complete`. `initiatingSecret` records the
 * project secret that started the challenge so `status` can 403 a foreign secret.
 */
type ClaimChallengeRecord = {
  challengeId: string;
  projectId: string;
  initiatingSecret: string;
  status: "pending" | "completed";
  expiresAt: string;
};

/**
 * The grant a completed claim writes. Keyed by project id (a project belongs to
 * exactly one team), mirroring the permission-engine grant ADR 046 describes —
 * there is no `claimed` status field on the project itself.
 */
type ClaimRecord = {
  teamId: string;
  claimedAt: string;
  dashboardUrl: string;
};

type Store = {
  projects: Map<string, ProjectRecord>;
  schemas: Map<string, SchemaRecord>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
  claimChallenges: Map<string, ClaimChallengeRecord>;
  claims: Map<string, ClaimRecord>;
};

function makeStore(): Store {
  return {
    projects: new Map(),
    schemas: new Map(),
    flowDefinitions: new Map(),
    claimChallenges: new Map(),
    claims: new Map(),
  };
}

const CLAIM_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** Extract a bearer token from the Authorization header, or "" when absent. */
function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
}

/**
 * Build a `flow-definition-detail-response` envelope around a stored body, as
 * specified by `api/openapi/components/flows/flow-definition-detail-response.yaml`.
 * The Go server unconditionally echoes an `audience` (empty `{}` when the
 * stored flow has none — `internal/api/flow_definition.go`); mirror that so
 * consumers exercise the same wire shape the live server produces.
 */
function flowDetailResponse(r: FlowDefinitionRecord): GetFlowDefinition200 {
  return {
    id: r.id,
    project_id: r.projectId,
    schema_uri: r.schemaUri,
    status: r.status,
    flow_definition: {
      audience: {},
      ...(r.body as Record<string, unknown>),
    } as unknown as GetFlowDefinition200['flow_definition'],
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
    status: r.status as ListFlowDefinitions200FlowDefinitionsItem["status"],
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function defaultHumanUserSchema(): GetSchemaById200 {
  return getDefaultHumanUserSchema() as unknown as GetSchemaById200;
}

function seedDefaultProjectResources(projectID: string, createdAt: string): void {
  const schemaId = `sch_${shortId()}`;
  const body = defaultHumanUserSchema();
  store.schemas.set(schemaId, {
    id: schemaId,
    projectId: projectID,
    objectType: schemaObjectType(body),
    createdAt,
    body,
  });
  const id = `flow_${shortId()}`;
  store.flowDefinitions.set(id, {
    id,
    name: "default-login",
    projectId: projectID,
    schemaUri: DEFAULT_FLOW_SCHEMA_URI,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    body: getDefaultLoginFlow({ userSchemaUrl: schemaId }) as unknown as Record<string, unknown>,
  });
}

function schemaObjectType(body: GetSchemaById200): string | undefined {
  const value = (body as unknown as { objectType?: unknown }).objectType;
  return typeof value === "string" ? value : undefined;
}

function requiredProjectID(
  request: Request,
): { ok: true; data: string } | { ok: false; response: HttpResponse<ErrorBody> } {
  const projectID = new URL(request.url).searchParams.get("project_id");
  if (projectID) {
    return { ok: true, data: projectID };
  }
  return {
    ok: false,
    response: HttpResponse.json(errorBody("invalid_query", "project_id is required"), {
      status: 400,
    }),
  };
}

function schemaID(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

let store: Store = makeStore();

/** Reset all in-memory state between tests. */
export function resetPlatformStore(): void {
  store = makeStore();
}

export type PlatformStoreSnapshot = {
  projects: number;
  schemas: number;
  flowDefinitions: number;
  claimChallenges: number;
  claims: number;
  projectIds: string[];
  schemaIds: string[];
  flowDefinitionIds: string[];
  /**
   * Ids of the live challenges. A caller that drove `claim/init` over HTTP
   * (a CLI under test, say) never sees the response body, so this is the only
   * way to learn the id it needs to hand to {@link completeClaimChallenge} or
   * {@link expireClaimChallenge}.
   */
  claimChallengeIds: string[];
};

export function snapshotPlatformStore(): PlatformStoreSnapshot {
  return {
    projects: store.projects.size,
    schemas: store.schemas.size,
    flowDefinitions: store.flowDefinitions.size,
    claimChallenges: store.claimChallenges.size,
    claims: store.claims.size,
    projectIds: [...store.projects.keys()],
    schemaIds: [...store.schemas.keys()],
    flowDefinitionIds: [...store.flowDefinitions.keys()],
    claimChallengeIds: [...store.claimChallenges.keys()],
  };
}

/**
 * Test/server mutators for the claim challenge lifecycle. Exported so the
 * conformance suite can force expiry and the Express `claim/complete` route
 * (which needs the module-scoped session store) can spend a challenge.
 */
export function expireClaimChallenge(challengeId: string): void {
  const challenge = store.claimChallenges.get(challengeId);
  if (challenge) {
    challenge.expiresAt = new Date(Date.now() - 1000).toISOString();
  }
}

export function completeClaimChallenge(
  challengeId: string,
  projectId: string,
): { status: number; body: CompleteClaim200 | ErrorBody } {
  const challenge = store.claimChallenges.get(challengeId);
  if (!challenge || challenge.projectId !== projectId) {
    return { status: 404, body: errorBody("not_found", "claim challenge not found") };
  }
  // The TTL is enforced regardless of status: an expired challenge is gone even
  // if it was already spent, so a completed-but-expired challenge still 410s.
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return {
      status: 410,
      body: errorBody("proj.claim_expired", "the claim challenge has expired"),
    };
  }
  // First-claim-wins and single-use: once the project has a grant — whether
  // from this challenge on an earlier call or from another challenge entirely —
  // completion reports it as already claimed instead of minting a second grant
  // or silently succeeding again.
  const existing = store.claims.get(projectId);
  if (existing) {
    return {
      status: 409,
      body: errorBody("proj.already_claimed", "the project is already claimed by a team", {
        team_id: existing.teamId,
        dashboard_url: existing.dashboardUrl,
      }),
    };
  }

  const teamId = `team-${shortId()}`;
  const claim: ClaimRecord = {
    teamId,
    claimedAt: nowIso(),
    dashboardUrl: `https://dashboard.example.com/teams/${teamId}`,
  };
  store.claims.set(projectId, claim);
  challenge.status = "completed";

  const responseBody: CompleteClaim200 = {
    project_id: projectId,
    team_id: claim.teamId,
    claimed_at: claim.claimedAt,
  };
  const out = CompleteClaimResponse.safeParse(responseBody);
  if (!out.success) {
    return {
      status: 500,
      body: errorBody("mock_response_invalid", "mock response does not conform to spec", {
        issues: out.error.issues,
      }),
    };
  }
  return { status: 200, body: out.data as CompleteClaim200 };
}

/**
 * Mirror of the server's definition-time validation
 * (`internal/domain/flow_definition_validator.go`, ported to
 * `@zitadel/config/validate`): same rules, same fail-fast single-detail
 * `flowdef.invalid` envelope. Divergence kept deliberately lenient: the
 * schema-dependent subset runs only when the pinned `user_schema` resolves
 * in the mock store — the real server would fail such a flow with
 * `schema_fetch_failed`, but fixtures here may pin external URLs.
 * Returns null when the definition is valid.
 */
function invalidFlowDefinitionResponse(
  flowDefinition: Record<string, unknown>,
): Response | null {
  const ref = flowDefinition.user_schema;
  const schema = typeof ref === "string" ? store.schemas.get(ref)?.body : undefined;
  const firstError = validateFlowDefinition(
    flowDefinition,
    schema as object | undefined,
  ).find((issue) => issue.severity === "error");
  if (!firstError) {
    return null;
  }
  // `details` is a bare string here — mirroring what the Go server actually
  // emits for ErrFlowDefinitionInvalid (its Details field is `any`), which
  // the CLI's pickDetailString handles alongside the spec's object shape.
  return HttpResponse.json(
    {
      code: "flowdef.invalid",
      message: "flow definition: invalid",
      details: firstError.message,
    },
    { status: 400 },
  );
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
        name: body.data.name,
        projectSecret: `sk_proj_${id.replaceAll("-", "")}_full`,
        previewSecret: `sk_proj_${id.replaceAll("-", "")}_preview`,
        previewOrigins: body.data.previewOrigins ?? [],
        createdAt,
        updatedAt: createdAt,
      };
      store.projects.set(id, project);
      if (body.data.seedDefaults ?? true) {
        seedDefaultProjectResources(project.id, createdAt);
      }
      const responseBody: CreateProject201 = {
        id: project.id,
        name: project.name,
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
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      const out = parse(GetProjectResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // POST /projects/:project_id/claim/init — mint a claim challenge. Auth
    // mirrors the real server: the project secret is the bearer (as in GET
    // /users). First-claim-wins is a 409 derived from the existing claim.
    http.post("*/projects/:project_id/claim/init", ({ params, request }) => {
      const path = parse(InitClaimParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const token = bearerToken(request);
      const authed = [...store.projects.values()].find((p) => p.projectSecret === token);
      if (!authed) {
        return HttpResponse.json(errorBody("auth.unauthorized", "missing or invalid credentials"), {
          status: 401,
        });
      }
      // The project secret is project-scoped: it may only initiate a claim for
      // its own project. A secret belonging to a different project cannot reach
      // this project, so it is treated as not found rather than authorized.
      if (authed.id !== path.data.project_id) {
        return HttpResponse.json(errorBody("proj.not_found", "project not found"), { status: 404 });
      }
      const project = authed;
      const claim = store.claims.get(project.id);
      if (claim) {
        return HttpResponse.json(
          errorBody("proj.already_claimed", "the project is already claimed by a team", {
            team_id: claim.teamId,
            dashboard_url: claim.dashboardUrl,
          }),
          { status: 409 },
        );
      }

      const id = challengeId();
      const expiresAt = new Date(Date.now() + CLAIM_CHALLENGE_TTL_MS).toISOString();
      store.claimChallenges.set(id, {
        challengeId: id,
        projectId: project.id,
        initiatingSecret: token,
        status: "pending",
        expiresAt,
      });
      const responseBody: InitClaim201 = {
        claim_url: `${new URL(request.url).origin}/claim/${id}`,
        challenge_id: id,
        expires_at: expiresAt,
      };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    // GET /projects/:project_id/claim/status — poll a challenge. The bearer
    // must be a valid project secret (401 otherwise) and specifically the one
    // that initiated the challenge (403 otherwise). Outbound-validated like
    // GET /projects/:id so the mock cannot lie about its own output.
    http.get("*/projects/:project_id/claim/status", ({ params, request }) => {
      const path = parse(GetClaimStatusParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetClaimStatusQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      // A missing, malformed, or unknown bearer is unauthenticated (401),
      // distinct from a valid secret that simply did not initiate this
      // challenge (403 below).
      const token = bearerToken(request);
      const authed = [...store.projects.values()].find((p) => p.projectSecret === token);
      if (!authed) {
        return HttpResponse.json(errorBody("auth.unauthorized", "missing or invalid credentials"), {
          status: 401,
        });
      }

      const challenge = store.claimChallenges.get(query.data.challenge_id);
      if (!challenge || challenge.projectId !== path.data.project_id) {
        return HttpResponse.json(errorBody("not_found", "claim challenge not found"), {
          status: 404,
        });
      }
      if (challenge.initiatingSecret !== token) {
        return HttpResponse.json(
          errorBody("proj.permission_denied", "the presented project secret did not initiate this challenge"),
          { status: 403 },
        );
      }
      // The TTL is enforced regardless of status: an ephemeral challenge is
      // gone once expired, so status stops being readable even after it
      // completed. The durable grant lives in `store.claims`, not here.
      if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        return HttpResponse.json(
          errorBody("proj.claim_expired", "the claim challenge has expired"),
          { status: 410 },
        );
      }

      let responseBody: GetClaimStatus200;
      if (challenge.status === "completed") {
        const claim = store.claims.get(challenge.projectId)!;
        responseBody = {
          status: "completed",
          team_id: claim.teamId,
          claimed_at: claim.claimedAt,
          dashboard_url: claim.dashboardUrl,
        };
      } else {
        responseBody = { status: "pending" };
      }
      const out = parse(GetClaimStatusResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // Users exist only through real sign-ups, which the platform mock has no
    // endpoint for — the list is always empty. That is exactly the state a
    // freshly set-up project is in, and what `status` keys its journey-staged
    // guidance on. Auth mirrors the real server: the project secret is the
    // bearer and scopes the (empty) result.
    http.get("*/users", ({ request }) => {
      // `limit` is numeric but URLs carry strings and the generated zod does not
      // coerce, so convert it before parsing. `page_token` is an opaque string —
      // coercing it too would parse every real cursor to NaN and 400 the request.
      const { limit, ...rest } = queryRecord(request);
      const raw = { ...rest, ...(limit === undefined ? {} : { limit: Number(limit) }) };
      const query = parse(ListUsersQueryParams, raw, "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const project = [...store.projects.values()].find((p) => p.projectSecret === token);
      if (!project) {
        return HttpResponse.json(errorBody("unauthenticated", "missing or invalid credentials"), {
          status: 401,
        });
      }
      return HttpResponse.json({ users: [] });
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

      const schemaBody = raw as unknown as GetSchemaById200;
      const id = `sch_${shortId()}`;
      store.schemas.set(id, {
        id,
        projectId: query.data.project_id,
        objectType: schemaObjectType(schemaBody),
        createdAt: nowIso(),
        body: schemaBody,
      });
      const responseBody: CreateSchema201 = { id };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/schemas", ({ request }) => {
      const url = new URL(request.url);
      const projectId = url.searchParams.get("project_id");
      if (!projectId) {
        return HttpResponse.json(errorBody("invalid_query", "project_id is required"), {
          status: 400,
        });
      }
      const objectTypeFilter = url.searchParams.get("object_type") ?? undefined;
      const records = [...store.schemas.values()]
        .filter((r) => r.projectId === projectId)
        .filter((r) => !objectTypeFilter || r.objectType === objectTypeFilter)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return HttpResponse.json(
        records.map((r) => ({ id: r.id, createdAt: r.createdAt })),
      );
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

      // Scoped by (project_id, id) like the real repository (GetByID takes
      // both); a schema belonging to another project reads as absent.
      const record = store.schemas.get(schemaID(path.data.id));
      if (!record || record.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return HttpResponse.json(record.body);
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

      // Same project scoping as GET: never delete another project's schema.
      const key = schemaID(path.data.id);
      const record = store.schemas.get(key);
      if (!record || record.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      store.schemas.delete(key);
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
      const invalid = invalidFlowDefinitionResponse(
        body.data.flow_definition as Record<string, unknown>,
      );
      if (invalid) {
        return invalid;
      }

      const id = `flow_${shortId()}`;
      const now = nowIso();
      const flowDef = body.data.flow_definition as Record<string, unknown>;
      const record: FlowDefinitionRecord = {
        id,
        name: flowDef.name as string,
        projectId: body.data.project_id,
        schemaUri: body.data.schema_uri ?? DEFAULT_FLOW_SCHEMA_URI,
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
        flow_definitions: [...store.flowDefinitions.values()]
          .filter((record) => record.projectId === query.data.project_id)
          .map(flowListItemResponse),
        next_page_token: null,
      };
      const out = parse(ListFlowDefinitionsResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.get("*/flow_definitions/:id", ({ params, request }) => {
      const path = parse(GetFlowDefinitionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = requiredProjectID(request);
      if (!query.ok) {
        return query.response;
      }

      const record = store.flowDefinitions.get(path.data.id);
      if (!record || record.projectId !== query.data) {
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
      const query = parse(
        UpdateFlowDefinitionQueryParams,
        queryRecord(request),
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }

      const record = store.flowDefinitions.get(path.data.id);
      if (!record || record.projectId !== query.data.project_id) {
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
      const invalid = invalidFlowDefinitionResponse(
        body.data.flow_definition as unknown as Record<string, unknown>,
      );
      if (invalid) {
        return invalid;
      }

      const flowDefinition = body.data.flow_definition as unknown as Record<string, unknown>;
      record.body = flowDefinition;
      record.name = typeof flowDefinition.name === "string" ? flowDefinition.name : record.name;
      record.schemaUri = body.data.schema_uri ?? record.schemaUri;
      record.status =
        typeof flowDefinition.status === "string" ? flowDefinition.status : record.status;
      record.updatedAt = nowIso();
      const responseBody: UpdateFlowDefinition200 = flowDetailResponse(record);
      const out = parse(UpdateFlowDefinitionResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: 200 });
    }),

    http.delete("*/flow_definitions/:id", ({ params, request }) => {
      const path = parse(DeleteFlowDefinitionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = requiredProjectID(request);
      if (!query.ok) {
        return query.response;
      }

      const record = store.flowDefinitions.get(path.data.id);
      if (!record || record.projectId !== query.data) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const existed = store.flowDefinitions.delete(path.data.id);
      if (!existed) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
