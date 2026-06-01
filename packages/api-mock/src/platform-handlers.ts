/**
 * MSW handlers for the Zitadel platform API used by the CLI.
 *
 * Covers (in sync with `api/openapi/openapi-spec.yaml` on main):
 *   - POST   /projects
 *   - GET    /projects/:id
 *   - PATCH  /projects/:id/config
 *   - POST   /projects/:id/claim/init
 *   - POST   /projects/:id/claim/complete
 *   - GET    /projects/:id/claim/status
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
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = raw as { preview_origins?: string[] };
      const requestHash = JSON.stringify({ preview_origins: body.preview_origins ?? [] });
      const idempotencyKey = request.headers.get("Idempotency-Key");
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
        preview_origins: body.preview_origins ?? [],
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

    http.get("*/projects/:id", ({ params, request }) => {
      const project = store.projects.get(params.id as string);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const authError = projectSecretAuthError(request, project);
      if (authError) return authError;
      return HttpResponse.json(getProjectResponse(project));
    }),

    http.patch("*/projects/:id/config", ({ params, request }) => {
      const project = store.projects.get(params.id as string);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const authError = projectSecretAuthError(request, project);
      if (authError) return authError;
      const environment = new URL(request.url).searchParams.get("environment") ?? "development";
      if (
        (environment === "preview" || environment === "production") &&
        project.lifecycle !== "claimed"
      ) {
        return HttpResponse.json(
          errorBody("proj.claim_required", "project must be claimed before this operation", {
            project_id: project.project_id,
            environment,
          }),
          { status: 409 },
        );
      }
      const responseBody: ApplyProjectConfig200 = {
        project_id: project.project_id,
        environment: environment as ApplyProjectConfig200["environment"],
        lifecycle: project.lifecycle,
        applied_at: nowIso(),
      };
      return HttpResponse.json(responseBody);
    }),

    http.post("*/projects/:id/claim/init", async ({ params, request }) => {
      const project = store.projects.get(params.id as string);
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

    http.post("*/projects/:id/claim/complete", async ({ params, request }) => {
      const project = store.projects.get(params.id as string);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const body = await readJson(request);
      if (body === null || typeof body.challenge_id !== "string") {
        return HttpResponse.json(errorBody("invalid_json", "challenge_id is required"), {
          status: 400,
        });
      }
      const challenge = store.claimChallenges.get(body.challenge_id);
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
      const teamChoice = isRecord(body.team_choice) ? body.team_choice : {};
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
      return HttpResponse.json(responseBody);
    }),

    http.get("*/projects/:id/claim/status", ({ params, request }) => {
      const project = store.projects.get(params.id as string);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "resource not found"), { status: 404 });
      }
      const challengeId = new URL(request.url).searchParams.get("challenge_id");
      const challenge = challengeId ? store.claimChallenges.get(challengeId) : undefined;
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
      return HttpResponse.json(responseBody);
    }),

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
      store.schemas.set(id, body as unknown as GetSchemaById200);
      const responseBody: CreateSchema201 = { id };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/schemas/:id", ({ params }) => {
      const schema = store.schemas.get(params.id as string);
      if (!schema) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return HttpResponse.json(schema);
    }),

    http.delete("*/schemas/:id", ({ params }) => {
      const existed = store.schemas.delete(params.id as string);
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

    http.get("*/flow_definitions", () => {
      const responseBody: ListFlowDefinitions200 = {
        flow_definitions: [...store.flowDefinitions.values()].map(flowDetailResponse),
        next_page_token: null,
      };
      return HttpResponse.json(responseBody);
    }),

    http.get("*/flow_definitions/:id", ({ params }) => {
      const record = store.flowDefinitions.get(params.id as string);
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetFlowDefinition200 = flowDetailResponse(record);
      return HttpResponse.json(responseBody);
    }),

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

    http.delete("*/flow_definitions/:id", ({ params }) => {
      const existed = store.flowDefinitions.delete(params.id as string);
      if (!existed) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
