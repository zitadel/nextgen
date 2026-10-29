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
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { serverCanonicalFlow } from "./server-canonical-flow.js";

import type {
  AddOrigin201,
  CompleteClaim200,
  CreateFlowDefinition201,
  CreateProject201,
  CreateProject201OriginsItem,
  CreateSchema201,
  GetClaimWindow200,
  GetClaimStatus200,
  GetFlowDefinition200,
  GetProject200,
  GetSchemaById200,
  GetSchemaById200Schema,
  InitClaim201,
  ListFlowDefinitions200,
  ListSchemas200,
} from "@zitadel/api/generated/model";
import {
  AddOriginBody,
  AddOriginParams,
  AddOriginResponse,
  CompleteClaimResponse,
  CreateFlowDefinitionBody,
  CreateIdpBody,
  CreateIdpQueryParams,
  CreateIdpResponse,
  BuildReleaseBody,
  BuildReleaseQueryParams,
  CreateDeploymentBody,
  CreateDeploymentQueryParams,
  CreateProjectBody,
  CreateReleaseBody,
  CreateReleaseQueryParams,
  CreateSchemaBody,
  CreateSchemaQueryParams,
  DeleteVariableParams,
  DeleteVariableQueryParams,
  GetClaimStatusParams,
  GetClaimStatusQueryParams,
  GetClaimStatusResponse,
  GetClaimWindowParams,
  GetClaimWindowQueryParams,
  GetClaimWindowResponse,
  GetDeploymentByIdParams,
  GetDeploymentByIdQueryParams,
  GetFlowDefinitionParams,
  GetFlowDefinitionResponse,
  GetIdpByIdParams,
  GetIdpByIdQueryParams,
  GetIdpByIdResponse,
  GetPolicyParams,
  GetPolicyQueryParams,
  GetPolicyResponse,
  GetPolicyRevisionParams,
  GetPolicyRevisionQueryParams,
  GetPolicyRevisionResponse,
  GetProjectParams,
  GetProjectResponse,
  GetReleaseByIdParams,
  GetReleaseByIdQueryParams,
  GetSchemaByIdParams,
  GetSchemaByIdQueryParams,
  GetVariableParams,
  GetVariableQueryParams,
  GetVariableResponse,
  GetVariablesQueryParams,
  GetVariablesResponse,
  InitClaimParams,
  ListDeploymentsQueryParams,
  ListFlowDefinitionsQueryParams,
  ListFlowDefinitionsResponse,
  ListPreviewsParams,
  ListPreviewsQueryParams,
  ListPreviewsResponse,
  ListReleasesQueryParams,
  ListPoliciesQueryParams,
  ListPoliciesResponse,
  ListPolicyRevisionsParams,
  ListPolicyRevisionsQueryParams,
  ListPolicyRevisionsResponse,
  ListSchemasQueryParams,
  PublishPolicyQueryParams,
  EvaluatePolicyBody,
  EvaluatePolicyQueryParams,
  EvaluatePolicyResponse,
  PublishPolicyResponse,
  QueryIdpsBody,
  QueryIdpsQueryParams,
  QueryIdpsResponse,
  QueryUsersBody,
  RemoveOriginBody,
  RemoveOriginParams,
  RemovePreviewBody,
  RemovePreviewParams,
  RevokeReleaseParams,
  RevokeReleaseQueryParams,
  RollbackDeploymentBody,
  RollbackDeploymentParams,
  RollbackDeploymentQueryParams,
  UpdateVariablesBody,
  UpdateVariablesQueryParams,
  UpdateVariablesResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { validateFlowDefinition } from "@zitadel/config/validate";
import { getDefaultHumanUserSchema, getDefaultLoginFlow } from "@zitadel/config/defaults";
import { missingEndpoints } from "@zitadel/config/idp";
import { policyConfigSchema } from "@zitadel/config/schemas";
import { http, HttpResponse } from "msw";
import { z } from "zod";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
 * A `GET` list's query record with `limit` as a number: URLs carry strings and
 * the generated zod does not coerce, so an out-of-range limit is refused by the
 * schema rather than silently normalised.
 */
function listQueryRecord(request: Request): Record<string, unknown> {
  const { limit, ...rest } = queryRecord(request);
  return { ...rest, ...(limit === undefined ? {} : { limit: Number(limit) }) };
}

/**
 * One page of a `GET` list. The real cursor is opaque; the mock's is the next
 * start index, and a token it never minted is refused with `req.invalid`, like
 * the real server.
 */
function pageOf<T>(
  records: readonly T[],
  limit: number,
  pageToken: string | undefined,
):
  | { ok: true; page: T[]; next: string | undefined }
  | { ok: false; response: HttpResponse<ErrorBody> } {
  const start = pageToken === undefined ? 0 : Number(pageToken);
  if (!Number.isInteger(start) || start < 0) {
    return {
      ok: false,
      response: HttpResponse.json(errorBody("req.invalid", "invalid page token"), { status: 400 }),
    };
  }
  const page = records.slice(start, start + limit);
  return {
    ok: true,
    page,
    next: start + limit < records.length ? String(start + limit) : undefined,
  };
}

/**
 * Server-side record for a project: the server-only secrets and `updatedAt`
 * on top of the spec's project fields. It does not hold `owning_team_id`,
 * which `GetProject200` requires: the handlers derive that from the claims at
 * the boundary, where they project this record to the right wire shape.
 */
type ProjectRecord = {
  id: string;
  name: string;
  projectSecret: string;
  previewSecret: string;
  origins: CreateProject201OriginsItem[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Server-side metadata wrapped around the flow body so the mock can answer
 * `flow-definition-response` per the OpenAPI contract.
 */
type FlowDefinitionRecord = {
  id: string;
  projectId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  seq: number;
  body: Record<string, unknown>;
};

/**
 * Server-side metadata wrapped around the schema body so the mock can answer
 * `POST /schemas` (returns id) and, for `GET /schemas/:id` and `GET /schemas`,
 * build the `{id, schema, metadata}` envelope around the stored document
 * (list filterable by object_type).
 */
type SchemaRecord = {
  id: string;
  projectId: string;
  objectType?: string;
  createdAt: string;
  seq: number;
  body: GetSchemaById200Schema;
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

/**
 * One identity provider connection, as the CLI's syncer publishes it.
 *
 * Keyed by `id`; `slug` is what dedupes a write. The server files each edit as
 * a revision beneath one connection id, so a second `POST /idps` carrying a
 * slug that already exists revises it rather than creating a second row —
 * which is what keeps the CLI's `plan`/`apply` idempotent.
 */
type IdpConnectionRecord = {
  id: string;
  revisionId: string;
  projectId: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  seq: number;
  body: Record<string, unknown>;
};

/**
 * One operation policy (ADR 066), as the CLI's policy syncer publishes it.
 *
 * Keyed by `id`; `operation` is what dedupes a write. A project has one policy
 * per operation, and every publish appends a revision beneath its id, so a
 * second `POST /policies` for the same operation revises it — which is what
 * keeps the CLI's `plan`/`apply` idempotent. Revisions are oldest first.
 */
type PolicyRecord = {
  id: string;
  projectId: string;
  operation: string;
  createdAt: string;
  seq: number;
  revisions: Array<{ revisionId: string; config: Record<string, unknown>; createdAt: string }>;
};

/**
 * One variable at the project level, which is the only owner the API addresses
 * today. `secret` decides what a read may say: a secret reports that a value is
 * held and withholds it (ADR 062 §7), so the stored value is only ever resolved
 * into a connection, never returned.
 */
type VariableRecord = { value: string | number | boolean; secret: boolean };

/**
 * One pinned resource of a release: which resource (`kind` + `handle`) and
 * which revision of it. A bundle synthesises the revision id; `pointers` pins
 * one that already exists.
 */
type ReleasePointer = { kind: string; handle: string; revision_id: string };

/**
 * A release in the store. `contentHash` is the bare 64-hex digest without the
 * `sha256:` prefix — the prefix is added at the wire boundary, as the Go
 * converter does — and is what dedupes a re-submitted bundle or pointer set.
 * `revokedAt` is null until the release is revoked, after which it can never be
 * served again.
 */
type ReleaseRecord = {
  id: string;
  projectId: string;
  contentHash: string;
  pointers: ReleasePointer[];
  message: string | null;
  gitSha: string | null;
  gitDirty: boolean;
  createdAt: string;
  revokedAt: string | null;
  seq: number;
};

/** One origin a deployment made its release live on, with a preview's expiry. */
type DeploymentTargetRow = { origin: string; expiresAt: string | null };

/**
 * A deployment in the store: the release, the resolved targets, and why it
 * happened. Append-only — a later deployment to an origin supersedes this one
 * there without rewriting it. `rollbackTo` names the deployment a rollback
 * re-applied, null otherwise.
 */
type DeploymentRecord = {
  id: string;
  projectId: string;
  releaseId: string;
  targets: DeploymentTargetRow[];
  reason: "deploy" | "rollback";
  message: string | null;
  rollbackTo: string | null;
  deployedAt: string;
  seq: number;
};

/**
 * A live preview: an origin matching one of the project's preview patterns
 * that a preview deployment wrote. `createdAt` is set by the first deployment
 * to the URL and kept across renewals; `expiresAt` is reset from each
 * deployment's `ttl`. Removed outright by `POST /previews/remove` and treated
 * as gone once past `expiresAt`. Keyed by {@link previewKey}.
 */
type PreviewRecord = {
  projectId: string;
  origin: string;
  expiresAt: string;
  createdAt: string;
  seq: number;
};

type Store = {
  projects: Map<string, ProjectRecord>;
  schemas: Map<string, SchemaRecord>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
  idps: Map<string, IdpConnectionRecord>;
  releases: Map<string, ReleaseRecord>;
  deployments: Map<string, DeploymentRecord>;
  previews: Map<string, PreviewRecord>;
  policies: Map<string, PolicyRecord>;
  /**
   * Owner key -> variable name -> value. The project level and each
   * environment are separate owners: the project does not see into its
   * environments and an environment does not inherit the project's, so they
   * cannot share a bucket. See {@link variableOwner}.
   */
  variables: Map<string, Map<string, VariableRecord>>;
  claimChallenges: Map<string, ClaimChallengeRecord>;
  claims: Map<string, ClaimRecord>;
  // Publication order. `nowIso()` is millisecond-resolution and ids are
  // random, so two records minted back to back would tie with nothing to say
  // which came first. Only some server dialects mint time-ordered ids, so
  // this stands in for the id tiebreak rather than reproducing it.
  lastSeq: number;
};

function makeStore(): Store {
  return {
    projects: new Map(),
    schemas: new Map(),
    flowDefinitions: new Map(),
    idps: new Map(),
    releases: new Map(),
    deployments: new Map(),
    previews: new Map(),
    policies: new Map(),
    variables: new Map(),
    claimChallenges: new Map(),
    claims: new Map(),
    lastSeq: 0,
  };
}

const CLAIM_CHALLENGE_TTL_MS = 10 * 60 * 1000;

// Mirrors domain.ClaimWindow (internal/domain/claim.go): an unclaimed project
// can only be claimed within 14 days of creation; init and complete both 410
// with proj.claim_window_expired after that, and the already-claimed 409 wins
// over the closed window, matching the server's check order.
const CLAIM_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const CLAIM_WINDOW_EXPIRED_MESSAGE =
  "the project was not claimed within 14 days of creation and can no longer be claimed";

function claimWindowClosed(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > CLAIM_WINDOW_MS;
}

/** Extract a bearer token from the Authorization header, or "" when absent. */
function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
}

/**
 * Build a `flow-definition-response` envelope around a stored body, as
 * specified by `api/openapi/components/flows/flow-definition-response.yaml`.
 * Every read serves this — list included, which is the point of #939.
 * The Go server unconditionally echoes an `audience` (empty `{}` when the
 * stored flow has none — `internal/api/flow_definition.go`); mirror that so
 * consumers exercise the same wire shape the live server produces.
 */
function flowResponse(r: FlowDefinitionRecord): GetFlowDefinition200 {
  return {
    id: r.id,
    project_id: r.projectId,
    flow_definition: {
      audience: {},
      ...serverCanonicalFlow(r.body as Record<string, unknown>),
      // After the spread: an update that omits `status` keeps the stored one,
      // which is what the endpoint documents.
      status: r.status,
    } as unknown as GetFlowDefinition200["flow_definition"],
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  } as unknown as GetFlowDefinition200;
}

function defaultHumanUserSchema(): GetSchemaById200Schema {
  return getDefaultHumanUserSchema() as unknown as GetSchemaById200Schema;
}

function seedDefaultProjectResources(projectID: string, createdAt: string): void {
  const schemaId = `sch_${shortId()}`;
  const body = defaultHumanUserSchema();
  store.schemas.set(schemaId, {
    id: schemaId,
    projectId: projectID,
    objectType: schemaObjectType(body),
    createdAt,
    seq: ++store.lastSeq,
    body,
  });
  const id = `flowdef_${shortId()}`;
  store.flowDefinitions.set(id, {
    id,
    projectId: projectID,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    seq: ++store.lastSeq,
    body: getDefaultLoginFlow() as unknown as Record<string, unknown>,
  });
}

function schemaObjectType(body: GetSchemaById200Schema): string | undefined {
  const value = (body as unknown as { objectType?: unknown }).objectType;
  return typeof value === "string" ? value : undefined;
}

function schemaKind(body: GetSchemaById200Schema): string | undefined {
  const value = (body as unknown as { kind?: unknown }).kind;
  return typeof value === "string" ? value : undefined;
}

/**
 * `created_at DESC, id DESC`, the order the server lists in. `seq` stands in
 * for the id tiebreak.
 */
/**
 * Whether a connection passes every filter the query carries. Filters are
 * combined with AND, as the contract states.
 *
 * `slug` and `created_at` are the only filterable fields, and the mock supports
 * the operations the CLI sends. An operation it does not know is reported
 * rather than silently ignored: a filter that does not narrow looks like data
 * that is not there.
 */
function matchesIdpFilters(
  record: IdpConnectionRecord,
  filters: readonly { field: string; operation: string; value?: unknown }[] | undefined,
): boolean {
  for (const filter of filters ?? []) {
    const actual = filter.field === "slug" ? record.slug : record.createdAt;
    const expected = String(filter.value ?? "");
    const ok =
      filter.operation === "equals"
        ? actual === expected
        : filter.operation === "contains"
          ? actual.includes(expected)
          : filter.operation === "greater_than"
            ? actual > expected
            : filter.operation === "less_than"
              ? actual < expected
              : undefined;
    if (ok === undefined) {
      throw new Error(`api-mock: unsupported idp filter operation ${filter.operation}`);
    }
    if (!ok) {
      return false;
    }
  }
  return true;
}

/**
 * Which identity field a revision would change, or `undefined` when none would.
 *
 * `protocol`, `subject_claim` and the field naming the authority decide which
 * provider account a stored subject belongs to, so changing one repoints
 * existing identities rather than reconfiguring them. The server refuses that
 * for the life of the connection, and a mock that accepted it would let the CLI
 * pass a test the real service fails.
 */
function immutableFieldClash(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string | undefined {
  for (const field of ["protocol", "subject_claim"] as const) {
    if (before[field] !== undefined && before[field] !== after[field]) {
      return field;
    }
  }
  // The authority is the issuer.
  const was = before.oidc;
  const now = after.oidc;
  if (isObject(was) && isObject(now) && was.issuer !== undefined && was.issuer !== now.issuer) {
    return "oidc.issuer";
  }
  return undefined;
}

type VariableKind = "primary" | "preview";

/** The requested kind, or both. */
function variableKinds(kind?: VariableKind): VariableKind[] {
  return kind === undefined ? ["primary", "preview"] : [kind];
}

/** The store key of one kind of a project's variables. */
function variableOwner(projectId: string, kind: VariableKind): string {
  return `${projectId}/${kind}`;
}

/** The project's variables for the given kinds, keyed by name. */
function variablesResponse(
  variables: Map<string, Map<string, VariableRecord>>,
  projectId: string,
  kinds: VariableKind[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const kind of kinds) {
    for (const [name, held] of variables.get(variableOwner(projectId, kind)) ?? []) {
      // A secret is never returned.
      out[name] = { ...out[name], [kind]: held.secret ? { secret: true } : held.value };
    }
  }
  return out;
}

/** One connection, in the wire shape every idp endpoint answers with. */
function idpResponse(record: IdpConnectionRecord): Record<string, unknown> {
  return {
    id: record.id,
    revision_id: record.revisionId,
    slug: record.slug,
    definition: record.body,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

/** One policy revision, in the wire shape every policy endpoint answers with. */
function policyResponse(
  record: PolicyRecord,
  revision: PolicyRecord["revisions"][number],
): Record<string, unknown> {
  return {
    id: record.id,
    revision_id: revision.revisionId,
    project_id: record.projectId,
    operation: record.operation,
    config: revision.config,
    created_at: record.createdAt,
    updated_at: revision.createdAt,
  };
}

/** The newest revision of a policy; a stored policy always has one. */
/**
 * The violation the template's config rule `min_length_not_above_max_length`
 * (internal/policy/templates/auth.factor.password.set.json) reports.
 */
const MIN_ABOVE_MAX_VIOLATION = {
  config_rule: "min_length_not_above_max_length",
  settings: ["max_length", "min_length"],
};

/**
 * Whether a config breaks the template's config rule, which the server checks
 * on publish and on a release build. A rule the template gains must be added
 * here.
 */
function policyRuleViolated(config: Record<string, unknown>): boolean {
  const { min_length: min, max_length: max } = config;
  return typeof min === "number" && typeof max === "number" && min > max;
}

/**
 * Publish config as the operation's newest revision, creating the policy on
 * the first publish. With `reuseUnchanged`, a config equal to the newest
 * revision's reuses it, as a release build does.
 */
function publishPolicyRevision(
  projectId: string,
  operation: string,
  config: Record<string, unknown>,
  { reuseUnchanged = false }: { reuseUnchanged?: boolean } = {},
): { record: PolicyRecord; revision: PolicyRecord["revisions"][number] } {
  const existing = [...store.policies.values()].find(
    (record) => record.projectId === projectId && record.operation === operation,
  );
  if (reuseUnchanged && existing) {
    const newest = newestRevision(existing);
    if (JSON.stringify(sortedKeys(newest.config)) === JSON.stringify(sortedKeys(config))) {
      return { record: existing, revision: newest };
    }
  }
  const now = nowIso();
  const revision = { revisionId: `polrev_${shortId()}`, config, createdAt: now };
  const record: PolicyRecord = existing
    ? { ...existing, revisions: [...existing.revisions, revision] }
    : {
        id: `pol_${shortId()}`,
        projectId,
        operation,
        createdAt: now,
        seq: ++store.lastSeq,
        revisions: [revision],
      };
  store.policies.set(record.id, record);
  return { record, revision };
}

/**
 * The evaluate body as the server decodes it. The generated schema is not
 * strict (orval's `strict.body: false`), so it would drop an unknown key the
 * server refuses with `req.invalid`: `config`, `input` and `facts` are closed
 * here, while an extra top-level key is ignored, as on publish.
 */
const EvaluatePolicyStrictBody = EvaluatePolicyBody.extend({
  config: policyConfigSchema.shape.config,
  input: z.strictObject(EvaluatePolicyBody.shape.input.shape),
  facts: z.strictObject(EvaluatePolicyBody.shape.facts.unwrap().shape).optional(),
});

/** The server's length cap on a password (`domain.MaxPasswordLength`). */
const MAX_PASSWORD_LENGTH = 64;

/**
 * What `POST /policies/evaluate` answers for a password set: the server's
 * `CheckPassword` (internal/service/password_policy.go) on the given config.
 * The empty guard comes first, then the template's rules on the length in
 * code points after NFC, the history only for a user's own set within the
 * cap, and the cap as `max_length`. A rule the template gains must be added
 * here.
 */
function evaluatePasswordSet(
  config: Record<string, unknown>,
  password: string,
  facts: { self_service: boolean; history_matches: boolean[] },
): { allowed: boolean; code?: string; violations?: Record<string, unknown> } {
  const normalized = password.normalize("NFC");
  if (normalized === "") {
    return { allowed: false, code: "user.password_empty" };
  }
  const length = [...normalized].length;
  const { min_length: min, max_length: max, history_depth: depth } = config;
  const violations: Record<string, unknown> = {};
  if (typeof min === "number" && length < min) {
    violations.min_length = min;
  }
  if (typeof max === "number" && length > max) {
    violations.max_length = max;
  }
  if (
    typeof depth === "number" &&
    facts.self_service &&
    length <= MAX_PASSWORD_LENGTH &&
    facts.history_matches.slice(0, depth).some(Boolean)
  ) {
    violations.history_depth = depth;
  }
  if (!("max_length" in violations) && length > MAX_PASSWORD_LENGTH) {
    violations.max_length = MAX_PASSWORD_LENGTH;
  }
  if (Object.keys(violations).length === 0) {
    return { allowed: true };
  }
  return { allowed: false, code: "user.password_policy_violation", violations };
}

/** A shallow copy with its keys in order, so two configs compare by value. */
function sortedKeys(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b)));
}

function newestRevision(record: PolicyRecord): PolicyRecord["revisions"][number] {
  return record.revisions[record.revisions.length - 1] as PolicyRecord["revisions"][number];
}

const POLICY_NOT_FOUND = errorBody("pol.not_found", "policy: not found");

function compareNewestFirst(
  a: { createdAt: string; seq: number },
  b: { createdAt: string; seq: number },
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return b.seq - a.seq;
}

/**
 * `revisions=latest` keeps the newest revision of each `objectType`. Takes the
 * list already sorted newest-first, so the first record of an `objectType` is
 * the one to keep. A record without an `objectType` is a revision of nothing
 * and is kept rather than grouped — matching the server's anti-join, which
 * cannot correlate a NULL either.
 */
function latestSchemaRevisions(newestFirst: SchemaRecord[]): SchemaRecord[] {
  const seen = new Set<string>();
  return newestFirst.filter((r) => {
    if (r.objectType === undefined) {
      return true;
    }
    if (seen.has(r.objectType)) {
      return false;
    }
    seen.add(r.objectType);
    return true;
  });
}

/**
 * Mirrors the server's `purpose` filter: `purposes` maps each served purpose
 * to its entry step, so a flow serves a purpose when the key is present.
 */
function flowServesPurpose(body: Record<string, unknown>, purpose: string): boolean {
  const purposes = body.purposes;
  return typeof purposes === "object" && purposes !== null && Object.hasOwn(purposes, purpose);
}

/**
 * `revisions=latest` keeps the newest revision of each flow `name`. Takes the
 * list already sorted newest-first, so the first record of a name is the one
 * to keep — matching the server's anti-join on `(project_id, name)`.
 */
function latestFlowRevisions(newestFirst: FlowDefinitionRecord[]): FlowDefinitionRecord[] {
  const seen = new Set<string>();
  return newestFirst.filter((r) => {
    const name = r.body.name;
    if (typeof name !== "string") {
      return true;
    }
    if (seen.has(name)) {
      return false;
    }
    seen.add(name);
    return true;
  });
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
  idps: number;
  policies: number;
  claimChallenges: number;
  claims: number;
  projectIds: string[];
  schemaIds: string[];
  flowDefinitionIds: string[];
  /** Connection slugs, which is what schemas and flows reference. */
  idpSlugs: string[];
  /** Release ids, newest first, for a caller that drove the HTTP API. */
  releaseIds: string[];
  /** Release content digests (full `sha256:` form), insertion order. */
  releaseContentHashes: string[];
  /** Deployment ids, newest first. */
  deploymentIds: string[];
  /**
   * Variable names entered at the project, secrets included. Names only: a
   * secret's value is not readable over the API, and a snapshot that returned
   * it would be a way around that.
   */
  variableNames: string[];
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
    idps: store.idps.size,
    policies: store.policies.size,
    claimChallenges: store.claimChallenges.size,
    claims: store.claims.size,
    projectIds: [...store.projects.keys()],
    schemaIds: [...store.schemas.keys()],
    flowDefinitionIds: [...store.flowDefinitions.keys()],
    idpSlugs: [...store.idps.values()].map((record) => record.slug),
    releaseIds: [...store.releases.values()]
      .sort((a, b) => b.seq - a.seq)
      .map((release) => release.id),
    releaseContentHashes: [...store.releases.values()].map(
      (release) => `${RELEASE_CONTENT_HASH_PREFIX}${release.contentHash}`,
    ),
    deploymentIds: [...store.deployments.values()]
      .sort((a, b) => b.seq - a.seq)
      .map((deployment) => deployment.id),
    variableNames: [...store.variables.values()].flatMap((owned) => [...owned.keys()]),
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

/** Backdates the project past the claim window, for window-expiry tests. */
export function expireClaimWindow(projectId: string): void {
  const project = store.projects.get(projectId);
  if (project) {
    project.createdAt = new Date(Date.now() - CLAIM_WINDOW_MS - 1000).toISOString();
  }
}

export function completeClaimChallenge(
  challengeId: string,
  projectId: string,
): { status: number; body: CompleteClaim200 | ErrorBody } {
  const challenge = store.claimChallenges.get(challengeId);
  if (!challenge || challenge.projectId !== projectId) {
    return {
      status: 404,
      body: errorBody("claim_challenge.not_found", "claim challenge not found"),
    };
  }
  // Fail closed on a challenge without its project, mirroring the server's
  // proj.not_found: a claim must never be minted from an inconsistent store,
  // and letting it through would also bypass the window check below.
  const project = store.projects.get(projectId);
  if (!project) {
    return { status: 404, body: errorBody("proj.not_found", "project not found") };
  }
  // First-claim-wins and single-use, checked before both expiry answers
  // (server order): once the project has a grant — whether from this challenge
  // on an earlier call or from another challenge entirely — completion reports
  // it as already claimed instead of minting a second grant or silently
  // succeeding again. A completed challenge always has the grant, so it lands
  // here, never on the expiry answers below.
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
  // The closed window outranks challenge expiry (server order): both are 410,
  // but only challenge expiry recovers with a fresh init, so a both-expired
  // complete must report the final refusal.
  if (claimWindowClosed(project.createdAt)) {
    return {
      status: 410,
      body: errorBody("proj.claim_window_expired", CLAIM_WINDOW_EXPIRED_MESSAGE),
    };
  }
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return {
      status: 410,
      body: errorBody("proj.claim_expired", "the claim challenge has expired"),
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
 * schema-dependent subset runs only when `user_schema` resolves in the mock
 * store — the real server would refuse such a flow, but fixtures here may
 * name external URLs.
 * Returns null when the definition is valid.
 */
function invalidFlowDefinitionResponse(
  flowDefinition: Record<string, unknown>,
  schema: SchemaRecord | undefined,
): Response | null {
  const firstError = validateFlowDefinition(
    flowDefinition,
    schema?.body as object | undefined,
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

/**
 * The newest revision of the schema a flow's `user_schema` names, as the
 * server resolves it: a schema id stands for its `objectType`.
 */
function resolveUserSchema(projectId: string, ref: unknown): SchemaRecord | undefined {
  if (typeof ref !== "string") {
    return undefined;
  }
  const objectType = store.schemas.get(ref)?.objectType ?? ref;
  return [...store.schemas.values()]
    .filter((record) => record.projectId === projectId && record.objectType === objectType)
    .sort(compareNewestFirst)[0];
}

// --- releases and deployments ------------------------------------------
// Releases and deployments are stored in their own block so the two features
// do not collide with the rest of the store. The Go handlers are unimplemented
// stubs; the behaviour the CLI drives against lives here.

/** The wire prefix for a release digest. The store keeps the bare hex. */
const RELEASE_CONTENT_HASH_PREFIX = "sha256:";

/**
 * A stable digest over the content a release pins. Faithful enough for the
 * mock: it is a sha256 over a canonical JSON of the sorted entries, so the
 * same content always digests the same way and a re-submission dedupes. It
 * does not reproduce the server's RFC 8785 canonicalisation.
 */
function contentDigest(entries: { kind: string; handle: string; content: unknown }[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.kind === b.kind ? a.handle.localeCompare(b.handle) : a.kind.localeCompare(b.kind),
  );
  const canonical = JSON.stringify({ version: 1, resources: sorted });
  return createHash("sha256").update(canonical).digest("hex");
}

/** The handle a schema, flow definition or branding declares. */
function bundleResourceHandle(kind: string, resource: Record<string, unknown>): string {
  if (kind === "schema") {
    return typeof resource.objectType === "string" ? resource.objectType : "schema";
  }
  if (kind === "flow_definition") {
    return typeof resource.name === "string" ? resource.name : "flow";
  }
  if (kind === "idp") {
    return typeof resource.slug === "string" ? resource.slug : "idp";
  }
  if (kind === "policy") {
    return typeof resource.operation === "string" ? resource.operation : "policy";
  }
  return "default";
}

/**
 * Turn a bundle into pinned revisions, materialising each resource into the
 * store the way the server allocates revisions from a bundle: a schema or flow
 * whose content matches the project's newest revision of the same handle reuses
 * it, anything else allocates a new one. This is what makes a deployed schema or
 * flow observable through `schemas list` / `flow-definitions list`. Branding has
 * no store here, so it keeps a synthesised revision id.
 */
function materializeBundle(
  projectId: string,
  bundle: Record<string, unknown>,
  policyPointers: ReleasePointer[],
): ReleasePointer[] {
  const pointers: ReleasePointer[] = [...policyPointers];
  for (const item of asArray(bundle.schemas)) {
    const resource = isObject(item) ? item : {};
    const handle = bundleResourceHandle("schema", resource);
    const existing = [...store.schemas.values()].find(
      (record) =>
        record.projectId === projectId &&
        record.objectType === handle &&
        JSON.stringify(record.body) === JSON.stringify(resource),
    );
    const id = existing?.id ?? `sch_${shortId()}`;
    if (!existing) {
      store.schemas.set(id, {
        id,
        projectId,
        objectType: handle,
        createdAt: nowIso(),
        seq: ++store.lastSeq,
        body: resource as unknown as GetSchemaById200Schema,
      });
    }
    pointers.push({ kind: "schema", handle, revision_id: id });
  }
  for (const item of asArray(bundle.flow_definitions)) {
    const resource = isObject(item) ? item : {};
    const handle = bundleResourceHandle("flow_definition", resource);
    const existing = [...store.flowDefinitions.values()].find(
      (record) =>
        record.projectId === projectId &&
        record.body.name === handle &&
        JSON.stringify(record.body) === JSON.stringify(resource),
    );
    const id = existing?.id ?? `flowdef_${shortId()}`;
    if (!existing) {
      const createdAt = nowIso();
      store.flowDefinitions.set(id, {
        id,
        projectId,
        status: typeof resource.status === "string" ? resource.status : "active",
        createdAt,
        updatedAt: createdAt,
        seq: ++store.lastSeq,
        body: resource,
      });
    }
    pointers.push({ kind: "flow_definition", handle, revision_id: id });
  }
  // A connection is resolved by its slug, as the service does: an unchanged
  // document reuses the revision it already has, a changed one revises the same
  // connection so everything referencing the slug keeps pointing at it.
  for (const item of asArray(bundle.idps)) {
    const resource = isObject(item) ? item : {};
    const handle = bundleResourceHandle("idp", resource);
    const existing = [...store.idps.values()].find(
      (record) => record.projectId === projectId && record.slug === handle,
    );
    const unchanged =
      existing !== undefined && JSON.stringify(existing.body) === JSON.stringify(resource);
    const now = nowIso();
    const record: IdpConnectionRecord = unchanged
      ? (existing as IdpConnectionRecord)
      : existing
        ? {
            ...existing,
            revisionId: `idprev_${shortId()}`,
            updatedAt: now,
            seq: ++store.lastSeq,
            body: resource,
          }
        : {
            id: `idp_${shortId()}`,
            revisionId: `idprev_${shortId()}`,
            projectId,
            slug: handle,
            createdAt: now,
            updatedAt: now,
            seq: ++store.lastSeq,
            body: resource,
          };
    if (!unchanged) {
      store.idps.set(record.id, record);
    }
    pointers.push({ kind: "idp", handle, revision_id: record.revisionId });
  }
  for (const item of isObject(bundle.branding) ? [bundle.branding] : []) {
    const resource = item;
    pointers.push({
      kind: "branding",
      handle: bundleResourceHandle("branding", resource),
      revision_id: `branding_${shortId()}`,
    });
  }
  return pointers;
}

/**
 * The first connection in the bundle that would change a field fixed for the
 * life of the connection, with the field it changes.
 */
function bundleIdpClash(
  projectId: string,
  bundle: Record<string, unknown>,
): { slug: string; field: string } | undefined {
  for (const item of asArray(bundle.idps)) {
    const resource = isObject(item) ? item : {};
    const slug = bundleResourceHandle("idp", resource);
    const existing = [...store.idps.values()].find(
      (record) => record.projectId === projectId && record.slug === slug,
    );
    const field = existing === undefined ? undefined : immutableFieldClash(existing.body, resource);
    if (field !== undefined) {
      return { slug, field };
    }
  }
  return undefined;
}

/**
 * Publish a bundle's policies the way the service does inside a build, before
 * the release is looked up: an unchanged config reuses the operation's newest
 * revision, any other adds one. They run first because the revision a policy
 * gets decides the release's content, as it does on the server: going back to
 * an earlier config adds a revision and so builds a new release.
 */
function publishBundlePolicies(
  projectId: string,
  bundle: Record<string, unknown>,
): ReleasePointer[] {
  return asArray(bundle.policies).map((item) => {
    const resource = isObject(item) ? item : {};
    const handle = bundleResourceHandle("policy", resource);
    const config = isObject(resource.config) ? resource.config : {};
    const { revision } = publishPolicyRevision(projectId, handle, config, { reuseUnchanged: true });
    return { kind: "policy", handle, revision_id: revision.revisionId };
  });
}

/**
 * The `details.resources` entries a bundle's policies earn: a config the
 * template's rule refuses (`pol.invalid`), and both of two policies for one
 * operation (`rel.invalid`).
 */
function bundlePolicyFailures(bundle: Record<string, unknown>): Record<string, unknown>[] {
  const failures: Record<string, unknown>[] = [];
  const seen = new Map<string, number>();
  asArray(bundle.policies).forEach((item, index) => {
    const resource = isObject(item) ? item : {};
    const handle = bundleResourceHandle("policy", resource);
    const earlier = seen.get(handle);
    if (earlier !== undefined) {
      for (const at of [earlier, index]) {
        failures.push({
          kind: "policy",
          index: at,
          handle,
          code: "rel.invalid",
          message: `policy "${handle}" appears twice`,
        });
      }
      return;
    }
    seen.set(handle, index);
    if (policyRuleViolated(isObject(resource.config) ? resource.config : {})) {
      failures.push({
        kind: "policy",
        index,
        handle,
        code: "pol.invalid",
        message: "policy: invalid",
        details: { details: { violations: [MIN_ABOVE_MAX_VIOLATION] } },
      });
    }
  });
  return failures;
}

/** The array at a bundle field, or an empty one when the field is absent. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Everything a bundle carries, flattened for the digest, in input order. */
function bundleDigestEntries(
  bundle: Record<string, unknown>,
): { kind: string; handle: string; content: unknown }[] {
  const entries: { kind: string; handle: string; content: unknown }[] = [];
  const groups: [string, string][] = [
    ["schemas", "schema"],
    ["flow_definitions", "flow_definition"],
    ["idps", "idp"],
  ];
  for (const [field, kind] of groups) {
    const items = bundle[field];
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items) {
      const resource = isObject(item) ? item : {};
      entries.push({ kind, handle: bundleResourceHandle(kind, resource), content: resource });
    }
  }
  if (isObject(bundle.branding)) {
    entries.push({
      kind: "branding",
      handle: bundleResourceHandle("branding", bundle.branding),
      content: bundle.branding,
    });
  }
  return entries;
}

/**
 * The handle a pinned revision declares. Resolved from the store so a release
 * records the identity of the revision it pins, as the server does; `default`
 * for branding, and the revision id itself when nothing in the store answers.
 */
function pointerHandle(kind: string, revisionId: string): string {
  if (kind === "schema") {
    const record = store.schemas.get(revisionId);
    if (record?.objectType) {
      return record.objectType;
    }
  }
  if (kind === "flow_definition") {
    const record = store.flowDefinitions.get(revisionId);
    const name = record?.body.name;
    if (typeof name === "string") {
      return name;
    }
  }
  if (kind === "branding") {
    return "default";
  }
  return revisionId;
}

/**
 * The project's default preview lifetime, applied when a preview deployment
 * omits `ttl`. A real project configures this; the mock stands in one value
 * for every project, matching the spec's "omitted, the project's default
 * applies" (create-deployment-request.yaml).
 */
const DEFAULT_PREVIEW_TTL = "P7D";

/** The milliseconds an ISO-8601 duration spans, or undefined when it is not one. */
function isoDurationMs(ttl: string): number | undefined {
  // The same shapes the server's parser takes (internal/api/ogenx): whole days
  // and a time part in hours, minutes or fractional seconds. Weeks, months and
  // years are not among them, so the mock refuses what the server would.
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(ttl);
  if (!match) {
    return undefined;
  }
  const [, days, hours, minutes, seconds] = match;
  // A bare `P` or `PT` carries no components and is not a duration.
  if ([days, hours, minutes, seconds].every((part) => part === undefined)) {
    return undefined;
  }
  return (
    Number(days ?? 0) * 86_400_000 +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000
  );
}

/** Turn a `ttl` (`PT30M`, `PT168H`, `P7D`) into an ISO expiry counted from now. */
function ttlToExpiry(ttl: string): string {
  const ms = isoDurationMs(ttl);
  if (ms === undefined) {
    return new Date().toISOString();
  }
  return new Date(Date.now() + ms).toISOString();
}

/** The project's primary origins, as exact URLs, sorted. */
function primaryOrigins(project: ProjectRecord): string[] {
  return project.origins
    .filter((origin) => origin.kind === "primary")
    .map((origin) => origin.pattern)
    .sort();
}

/**
 * Whether a concrete origin matches one of the project's preview patterns. A
 * `*` in a pattern matches one or more characters that are not a dot, as the
 * origin rule (#1582) defines it.
 */
function matchesPreviewPattern(project: ProjectRecord, origin: string): boolean {
  for (const entry of project.origins) {
    if (entry.kind !== "preview") {
      continue;
    }
    const pattern = entry.pattern
      .replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? "\u0000" : `\\${ch}`))
      .replaceAll("\u0000", "[^.]+");
    if (new RegExp(`^${pattern}$`).test(origin)) {
      return true;
    }
  }
  return false;
}

/** The store key for a preview: unique per `(project, origin)`. */
function previewKey(projectId: string, origin: string): string {
  return `${projectId}\u0000${origin}`;
}

/** Whether a preview is still live: it exists and has not passed its expiry. */
function previewIsLive(preview: PreviewRecord | undefined): preview is PreviewRecord {
  return preview !== undefined && new Date(preview.expiresAt).getTime() > Date.now();
}

/**
 * The newest deployment to an origin, treating a preview that is gone as gone.
 * A preview's liveness is its preview row, not the expiry frozen onto the
 * deployment: `preview rm` deletes the row and a renewal moves its expiry, and
 * every endpoint has to agree on which previews are live.
 */
function newestDeploymentForOrigin(
  projectId: string,
  origin: string,
): DeploymentRecord | undefined {
  const previewLive = previewIsLive(store.previews.get(previewKey(projectId, origin)));
  return [...store.deployments.values()]
    .filter((deployment) => deployment.projectId === projectId)
    .filter((deployment) =>
      deployment.targets.some(
        (target) => target.origin === origin && (target.expiresAt === null || previewLive),
      ),
    )
    .sort((a, b) => b.seq - a.seq)[0];
}

/** The release metadata block, nulls written explicitly as the server does. */
function releaseMetadata(release: ReleaseRecord): Record<string, unknown> {
  return {
    message: release.message,
    git_sha: release.gitSha,
    git_dirty: release.gitDirty,
    created_at: release.createdAt,
    created_by: null,
    created_by_type: "service",
  };
}

/** The wire shape of a release, with its pointers. */
function releaseResponse(release: ReleaseRecord): Record<string, unknown> {
  return {
    id: release.id,
    project_id: release.projectId,
    content_hash: `${RELEASE_CONTENT_HASH_PREFIX}${release.contentHash}`,
    metadata: releaseMetadata(release),
    revoked_at: release.revokedAt,
    pointers: release.pointers,
  };
}

/**
 * Which origins a deployment went to: a preview target carries an expiry, a
 * primary one never does, and the two cannot be mixed in one deployment.
 */
/** The targets keyword, and stored origin, of the project default target. */
const DEFAULT_TARGET = "default";

function deploymentKind(deployment: DeploymentRecord): "primary" | "preview" {
  return deployment.targets.some((target) => target.expiresAt !== null) ? "preview" : "primary";
}

/**
 * Whether the deployment still serves its release: `live` while at least one
 * of its targets is served by it, `inactive` once a later deployment replaced
 * every one, or its previews expired or were removed.
 */
function deploymentStatus(deployment: DeploymentRecord): "live" | "inactive" {
  return deployment.targets.some(
    (target) =>
      newestDeploymentForOrigin(deployment.projectId, target.origin)?.id === deployment.id,
  )
    ? "live"
    : "inactive";
}

/** The wire shape of a deployment, optionally over a restricted target set. */
function deploymentResponse(
  deployment: DeploymentRecord,
  targets: DeploymentTargetRow[] = deployment.targets,
  expand?: { release: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: deployment.id,
    project_id: deployment.projectId,
    release_id: deployment.releaseId,
    targets: targets.map((target) =>
      target.expiresAt === null
        ? { origin: target.origin }
        : { origin: target.origin, expires_at: target.expiresAt },
    ),
    kind: deploymentKind(deployment),
    status: deploymentStatus(deployment),
    deployed_at: deployment.deployedAt,
    metadata: {
      reason: deployment.reason,
      message: deployment.message,
      rollback_to: deployment.rollbackTo,
      deployed_by: null,
      deployed_by_type: "service",
    },
  };
  if (expand?.release) {
    const release = store.releases.get(deployment.releaseId);
    if (release) {
      body.release = releaseResponse(release);
    }
  }
  return body;
}

/**
 * Create-or-dedup a release: an existing release with the same content answers
 * 200 and allocates nothing; otherwise a new record is written and answers 201.
 * `makePointers` is deferred so a bundle only materialises revisions when the
 * release is new, not on a deduped resubmission.
 */
function upsertRelease(
  projectId: string,
  digest: string,
  makePointers: () => ReleasePointer[],
  data: Record<string, unknown>,
) {
  const existing = [...store.releases.values()].find(
    (release) => release.projectId === projectId && release.contentHash === digest,
  );
  if (existing) {
    return HttpResponse.json(releaseResponse(existing), { status: 200 });
  }
  const id = `rel_${shortId()}`;
  const record: ReleaseRecord = {
    id,
    projectId,
    contentHash: digest,
    pointers: makePointers(),
    message: typeof data.message === "string" ? data.message : null,
    gitSha: typeof data.git_sha === "string" ? data.git_sha : null,
    gitDirty: data.git_dirty === true,
    createdAt: nowIso(),
    revokedAt: null,
    seq: ++store.lastSeq,
  };
  store.releases.set(id, record);
  return HttpResponse.json(releaseResponse(record), { status: 201 });
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
        origins: body.data.origins ?? [],
        createdAt,
        updatedAt: createdAt,
      };
      store.projects.set(id, project);
      if (body.data.seed_defaults ?? true) {
        seedDefaultProjectResources(project.id, createdAt);
      }
      const responseBody: CreateProject201 = {
        id: project.id,
        name: project.name,
        project_secret: project.projectSecret,
        preview_secret: project.previewSecret,
        origins: project.origins,
        created_at: project.createdAt,
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
        origins: project.origins,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
        // The claim's team owns the project, as the server's owning-team
        // assignment does; null until the project is claimed.
        owning_team_id: store.claims.get(project.id)?.teamId ?? null,
      };
      const out = parse(GetProjectResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // POST /projects/:project_id/origins/remove — drop one pattern. Missing
    // project is 404; removing an already-absent pattern is idempotent 204.
    http.post("*/projects/:project_id/origins/remove", async ({ params, request }) => {
      const path = parse(RemoveOriginParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(RemoveOriginBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("origin.not_found", "origin: not found"), {
          status: 404,
        });
      }

      const next = project.origins.filter((o) => o.pattern !== body.data.pattern);
      if (next.length !== project.origins.length) {
        project.origins = next;
        project.updatedAt = nowIso();
      }
      return new HttpResponse(null, { status: 204 });
    }),

    // POST /projects/:project_id/origins — add one {pattern, kind}. Same
    // pattern+kind is idempotent 201; same pattern with a different kind is
    // origin.kind_conflict. No check/warning field on the response.
    http.post("*/projects/:project_id/origins", async ({ params, request }) => {
      const path = parse(AddOriginParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(AddOriginBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("origin.not_found", "origin: not found"), {
          status: 404,
        });
      }

      const existing = project.origins.find((o) => o.pattern === body.data.pattern);
      if (existing && existing.kind !== body.data.kind) {
        return HttpResponse.json(
          errorBody(
            "origin.kind_conflict",
            "origin: the pattern is already stored with a different kind",
          ),
          { status: 409 },
        );
      }

      const origin: CreateProject201OriginsItem = {
        pattern: body.data.pattern,
        kind: body.data.kind,
      };
      if (!existing) {
        project.origins = [...project.origins, origin];
        project.updatedAt = nowIso();
      }

      const responseBody: AddOrigin201 = existing ?? origin;
      const out = parse(AddOriginResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: 201 });
    }),

    // --- releases --------------------------------------------------------
    // A release is assembled from a bundle (the CLI's form) or from pointers.
    // The content digest dedupes a re-submission; revoke blocks it from ever
    // being served again. The Go handlers are unimplemented stubs.

    // `POST /releases/build` — the CLI's path: build a release from the
    // `.zitadel/` bundle, reusing matching revisions and allocating the rest.
    http.post("*/releases/build", async ({ request }) => {
      const query = parse(BuildReleaseQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(BuildReleaseBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const project = store.projects.get(query.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("rel.project_not_found", "release: project not found"), {
          status: 404,
        });
      }
      const data = body.data as Record<string, unknown>;
      if (!isObject(data.bundle)) {
        return HttpResponse.json(errorBody("rel.invalid", "release: a build carries a bundle"), {
          status: 400,
        });
      }
      const bundle = data.bundle;
      // A connection's fixed fields are checked before anything is written, as
      // the service checks them inside the build's transaction: a bundle that
      // would change one is refused whole rather than revising it.
      const clash = bundleIdpClash(project.id, bundle);
      if (clash) {
        return HttpResponse.json(
          errorBody(
            "idp.field_immutable",
            `release: ${clash.slug}: the field ${clash.field} is fixed for the life of the connection`,
          ),
          { status: 400 },
        );
      }
      // The service validates each policy against its template and refuses two
      // for one operation, reporting every refused resource under
      // `rel.invalid`.
      const refused = bundlePolicyFailures(bundle);
      if (refused.length > 0) {
        return HttpResponse.json(
          errorBody("rel.invalid", "release: the bundle has invalid resources", {
            resources: refused,
          }),
          { status: 400 },
        );
      }
      const entries = bundleDigestEntries(bundle);
      const total = entries.length + asArray(bundle.policies).length;
      if (total === 0 || total > 50) {
        return HttpResponse.json(
          errorBody("rel.invalid", "release: a bundle carries between 1 and 50 resources"),
          { status: 400 },
        );
      }
      // Policies are published before the lookup, and the digest takes their
      // revision ids: see publishBundlePolicies.
      const policyPointers = publishBundlePolicies(project.id, bundle);
      for (const pointer of policyPointers) {
        entries.push({ kind: "policy", handle: pointer.handle, content: pointer.revision_id });
      }
      // `makePointers` is deferred so a bundle only materialises the other
      // revisions when the release is new, not on a deduped resubmission.
      return upsertRelease(
        project.id,
        contentDigest(entries),
        () => materializeBundle(project.id, bundle, policyPointers),
        data,
      );
    }),

    // `POST /releases` — pin pre-existing revision ids. Not a CLI flow, kept for
    // contract completeness.
    http.post("*/releases", async ({ request }) => {
      const query = parse(CreateReleaseQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateReleaseBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const project = store.projects.get(query.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("rel.project_not_found", "release: project not found"), {
          status: 404,
        });
      }
      const data = body.data as Record<string, unknown>;
      if (!Array.isArray(data.pointers)) {
        return HttpResponse.json(errorBody("rel.invalid", "release: a create pins pointers"), {
          status: 400,
        });
      }
      const pointers = data.pointers.map((item) => {
        const pointer = item as { kind: string; revision_id: string };
        return {
          kind: pointer.kind,
          handle: pointerHandle(pointer.kind, pointer.revision_id),
          revision_id: pointer.revision_id,
        };
      });
      const digest = contentDigest(
        pointers.map((pointer) => ({
          kind: pointer.kind,
          handle: pointer.handle,
          content: pointer.revision_id,
        })),
      );
      return upsertRelease(project.id, digest, () => pointers, data);
    }),

    http.get("*/releases", ({ request }) => {
      const query = parse(ListReleasesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const contentHash = queryRecord(request).content_hash;
      const releases = [...store.releases.values()]
        .filter((release) => release.projectId === query.data.project_id)
        .filter((release) =>
          contentHash === undefined
            ? true
            : `${RELEASE_CONTENT_HASH_PREFIX}${release.contentHash}` === contentHash,
        )
        .sort((a, b) => b.seq - a.seq)
        .map((release) => ({
          id: release.id,
          project_id: release.projectId,
          content_hash: `${RELEASE_CONTENT_HASH_PREFIX}${release.contentHash}`,
          metadata: releaseMetadata(release),
          revoked_at: release.revokedAt,
        }));
      return HttpResponse.json({ releases });
    }),

    http.get("*/releases/:release_id", ({ params, request }) => {
      const path = parse(GetReleaseByIdParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetReleaseByIdQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const release = store.releases.get(path.data.release_id);
      if (!release || release.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("rel.not_found", "release: not found"), { status: 404 });
      }
      return HttpResponse.json(releaseResponse(release));
    }),

    http.post("*/releases/:release_id/revoke", ({ params, request }) => {
      const path = parse(RevokeReleaseParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(RevokeReleaseQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const release = store.releases.get(path.data.release_id);
      if (!release || release.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("rel.not_found", "release: not found"), { status: 404 });
      }
      if (release.revokedAt !== null) {
        return HttpResponse.json(releaseResponse(release), { status: 200 });
      }

      // A release an origin still serves cannot be revoked: the live deployment
      // to any origin must not pin it.
      const servedBy: { origin: string; deployment_id: string }[] = [];
      const origins = new Set(
        [...store.deployments.values()]
          .filter((deployment) => deployment.projectId === release.projectId)
          .flatMap((deployment) => deployment.targets.map((target) => target.origin)),
      );
      for (const origin of origins) {
        const newest = newestDeploymentForOrigin(release.projectId, origin);
        if (newest?.releaseId === release.id) {
          servedBy.push({ origin, deployment_id: newest.id });
        }
      }
      if (servedBy.length > 0) {
        return HttpResponse.json(
          errorBody("rel.in_use", "release: still served by an origin", {
            origins: servedBy.sort((a, b) => a.origin.localeCompare(b.origin)),
          }),
          { status: 409 },
        );
      }

      release.revokedAt = nowIso();
      return HttpResponse.json(releaseResponse(release), { status: 200 });
    }),

    // --- deployments -----------------------------------------------------
    // A deployment makes a release live on a set of targets, expanding
    // `primary` to the project's primary origins. It is idempotent on what is
    // served and append-only; rollback re-applies an earlier one. Variable
    // freezing arrives with the variables work. The Go handlers are stubs.

    http.post("*/deployments", async ({ request }) => {
      const query = parse(CreateDeploymentQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateDeploymentBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const project = store.projects.get(query.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("env.project_not_found", "project not found"), {
          status: 404,
        });
      }

      const data = body.data as Record<string, unknown>;
      const hasReleaseId = typeof data.release_id === "string";
      const hasContentHash = typeof data.content_hash === "string";
      if (hasReleaseId === hasContentHash) {
        return HttpResponse.json(
          errorBody("dep.invalid", "deployment: name the release by exactly one of id or digest"),
          { status: 400 },
        );
      }
      const release = hasReleaseId
        ? store.releases.get(data.release_id as string)
        : [...store.releases.values()].find(
            // In this project: another project built from the same scaffold
            // holds a release with the very same digest.
            (candidate) =>
              candidate.projectId === project.id &&
              `${RELEASE_CONTENT_HASH_PREFIX}${candidate.contentHash}` === data.content_hash,
          );
      if (!release || release.projectId !== project.id) {
        return HttpResponse.json(errorBody("rel.not_found", "release: not found"), { status: 404 });
      }
      if (release.revokedAt !== null) {
        return HttpResponse.json(errorBody("rel.revoked", "release: revoked"), { status: 409 });
      }

      const requested = data.targets as string[];
      // The contract's targets are unique items: a repeated one is a malformed
      // request, not something to fold quietly.
      if (new Set(requested).size !== requested.length) {
        return HttpResponse.json(errorBody("dep.invalid", "deployment: targets must be unique"), {
          status: 400,
        });
      }
      const primaries = primaryOrigins(project);
      const resolved = new Set<string>();
      let sawPreview = false;
      let sawPrimary = false;
      let sawDefault = false;
      for (const target of requested) {
        // The default target serves callers with no origin. It is kept as its
        // wire token, which can never collide with an origin.
        if (target === DEFAULT_TARGET) {
          resolved.add(DEFAULT_TARGET);
          sawDefault = true;
          continue;
        }
        if (target === "primary") {
          if (primaries.length === 0) {
            return HttpResponse.json(
              errorBody("dep.invalid", "deployment: the project has no primary origin"),
              { status: 400 },
            );
          }
          for (const origin of primaries) {
            resolved.add(origin);
          }
          sawPrimary = true;
          continue;
        }
        if (primaries.includes(target)) {
          return HttpResponse.json(
            errorBody("dep.invalid", "deployment: deploy primary origins with the primary keyword"),
            { status: 400 },
          );
        }
        if (matchesPreviewPattern(project, target)) {
          resolved.add(target);
          sawPreview = true;
          continue;
        }
        return HttpResponse.json(
          errorBody(
            "proj.origin_not_allowed",
            `deployment: ${target} is neither a primary origin nor a preview URL of the project`,
          ),
          { status: 403 },
        );
      }
      if (sawPreview && sawDefault) {
        return HttpResponse.json(
          errorBody(
            "dep.invalid",
            "deployment: the default target and preview URLs cannot be mixed",
          ),
          { status: 400 },
        );
      }
      if (sawPreview && sawPrimary) {
        return HttpResponse.json(
          errorBody("dep.invalid", "deployment: primary origins and preview URLs cannot be mixed"),
          { status: 400 },
        );
      }
      const requestedTtl = typeof data.ttl === "string" ? data.ttl : undefined;
      if (requestedTtl !== undefined && !sawPreview) {
        return HttpResponse.json(
          errorBody("dep.invalid", "deployment: ttl is only valid for preview URLs"),
          { status: 400 },
        );
      }
      // A preview URL expires, so a deployment to one always gets a ttl. An
      // omitted ttl is not refused: the project's default applies, per
      // create-deployment-request.yaml, so a caller (the CLI included) need not
      // pin a lifetime of its own. A primary-only deployment keeps none.
      const ttl = sawPreview ? (requestedTtl ?? DEFAULT_PREVIEW_TTL) : undefined;
      // Resolved up here: the preview rows are renewed from this ttl before the
      // new deployment, which carries the same expiry, is written below.
      const expiresAt = sawPreview && ttl ? ttlToExpiry(ttl) : null;

      const targets = [...resolved].sort();
      const expectedId =
        typeof data.expected_deployment_id === "string" ? data.expected_deployment_id : undefined;
      // The contract's guard: the newest deployment to any of the targets.
      if (expectedId !== undefined) {
        const newest = targets
          .map((origin) => newestDeploymentForOrigin(project.id, origin))
          .filter((deployment): deployment is DeploymentRecord => deployment !== undefined)
          .sort((a, b) => b.seq - a.seq)[0];
        if (newest && newest.id !== expectedId) {
          return HttpResponse.json(
            errorBody(
              "dep.conflict",
              "deployment: the newest deployment to the targets does not match expected_deployment_id",
              { deployment: deploymentResponse(newest) },
            ),
            { status: 409 },
          );
        }
      }

      // A preview deploy always renews its targets' previews — writing a new one
      // or extending the live one's expiry from this deploy's ttl — so
      // re-deploying unchanged content keeps the preview URL alive rather than
      // letting it expire on its old clock.
      if (sawPreview && expiresAt !== null) {
        for (const origin of targets) {
          const key = previewKey(project.id, origin);
          const existing = store.previews.get(key);
          // Renew a still-live preview in place (keep its creation time and
          // order); but an expired one is gone, so redeploying it is a new
          // preview and gets a fresh createdAt/seq rather than resurrecting
          // stale metadata that would missort it in `preview list`.
          const live = previewIsLive(existing);
          store.previews.set(key, {
            projectId: project.id,
            origin,
            expiresAt,
            createdAt: live ? existing.createdAt : nowIso(),
            seq: live ? existing.seq : ++store.lastSeq,
          });
        }
      }

      // Idempotent on what is served: when every target already runs this
      // release, the newest deployment to the targets is returned unchanged.
      // Never for preview URLs: the contract has a preview deploy always write
      // a new deployment (201), which is how its expiry is renewed.
      const alreadyServed = targets.every(
        (origin) => newestDeploymentForOrigin(project.id, origin)?.releaseId === release.id,
      );
      if (targets.length > 0 && alreadyServed && !sawPreview) {
        const newest = [...store.deployments.values()]
          .filter(
            (deployment) =>
              deployment.projectId === project.id &&
              deployment.releaseId === release.id &&
              deployment.targets.some((target) => targets.includes(target.origin)),
          )
          .sort((a, b) => b.seq - a.seq)[0];
        if (newest) {
          return HttpResponse.json(deploymentResponse(newest), { status: 200 });
        }
      }

      const id = `dep_${shortId()}`;
      const createdAt = nowIso();
      const record: DeploymentRecord = {
        id,
        projectId: project.id,
        releaseId: release.id,
        targets: targets.map((origin) => ({ origin, expiresAt: sawPreview ? expiresAt : null })),
        reason: data.reason === "rollback" ? "rollback" : "deploy",
        message: typeof data.message === "string" ? data.message : null,
        rollbackTo: null,
        deployedAt: createdAt,
        seq: ++store.lastSeq,
      };
      store.deployments.set(id, record);
      return HttpResponse.json(deploymentResponse(record), { status: 201 });
    }),

    http.get("*/deployments", ({ request }) => {
      // URLs carry strings and the generated zod does not coerce: `live` is a
      // boolean, `limit` an int and `expand` an array, so build those before
      // validating, the way the schemas list handler coerces `limit`.
      const record = queryRecord(request);
      const expandRelease = (request.url.match(/[?&]expand=release\b/) ?? []).length > 0;
      const { live: liveRaw, limit, expand: _expand, ...rest } = record;
      const query = parse(
        ListDeploymentsQueryParams,
        {
          ...rest,
          ...(liveRaw === undefined ? {} : { live: liveRaw === "true" }),
          ...(limit === undefined ? {} : { limit: Number(limit) }),
          ...(expandRelease ? { expand: ["release"] } : {}),
        },
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }
      const origin = record.origin;
      const live = liveRaw === "true";

      let deployments = [...store.deployments.values()]
        .filter((deployment) => deployment.projectId === query.data.project_id)
        .sort((a, b) => b.seq - a.seq);
      if (origin !== undefined) {
        deployments = deployments.filter((deployment) =>
          deployment.targets.some((target) => target.origin === origin),
        );
      }

      let items: Record<string, unknown>[];
      if (live) {
        // What each target serves now: the newest deployment per origin, each
        // carrying only the targets it still serves.
        const serving = new Map<string, DeploymentTargetRow[]>();
        const liveOrigins = new Set(
          deployments.flatMap((deployment) => deployment.targets.map((target) => target.origin)),
        );
        for (const target of liveOrigins) {
          if (origin !== undefined && target !== origin) {
            continue;
          }
          // Pick the newest deployment targeting this origin by sequence,
          // without applying the target's frozen historical expiry: a renewed
          // preview extends its own row's clock (checked below), so filtering on
          // the deployment's stale expiry here would wrongly drop a live preview.
          const newest = [...store.deployments.values()]
            .filter((deployment) => deployment.projectId === query.data.project_id)
            .filter((deployment) => deployment.targets.some((t) => t.origin === target))
            .sort((a, b) => b.seq - a.seq)[0];
          if (!newest) {
            continue;
          }
          const row = newest.targets.find((candidate) => candidate.origin === target);
          if (!row) {
            continue;
          }
          // A preview-origin target (one with an expiry) is admitted by its
          // preview row, not by the expiry frozen onto the deployment: removing
          // the preview drops the URL from this live view without the historical
          // deployment being rewritten, and a renewed preview is reported on the
          // clock it now runs on. A primary target has no preview row and stands
          // on the deployment alone.
          let served = row;
          if (row.expiresAt !== null) {
            const preview = store.previews.get(previewKey(query.data.project_id, target));
            if (!previewIsLive(preview)) {
              continue;
            }
            served = { origin: row.origin, expiresAt: preview.expiresAt };
          }
          const rows = serving.get(newest.id) ?? [];
          rows.push(served);
          serving.set(newest.id, rows);
        }
        items = [...serving.entries()]
          .map(([id, rows]) => {
            const deployment = store.deployments.get(id);
            return deployment ? { deployment, rows } : undefined;
          })
          .filter(
            (entry): entry is { deployment: DeploymentRecord; rows: DeploymentTargetRow[] } =>
              entry !== undefined,
          )
          .sort((a, b) => b.deployment.seq - a.deployment.seq)
          .map((entry) =>
            deploymentResponse(entry.deployment, entry.rows, { release: expandRelease }),
          );
      } else {
        items = deployments.map((deployment) =>
          deploymentResponse(deployment, deployment.targets, { release: expandRelease }),
        );
      }
      // The real cursor is opaque; the mock's is the next start index, like the
      // schemas list. A target beyond the first page is only reachable by
      // following the cursor, so a caller that needs the whole history pages
      // through it rather than reading the first page alone.
      const start = query.data.page_token === undefined ? 0 : Number(query.data.page_token);
      if (!Number.isInteger(start) || start < 0) {
        return HttpResponse.json(errorBody("req.invalid", "invalid page token"), { status: 400 });
      }
      const page = items.slice(start, start + query.data.limit);
      const next =
        start + query.data.limit < items.length ? String(start + query.data.limit) : undefined;
      return HttpResponse.json({ deployments: page, next_page_token: next });
    }),

    http.get("*/deployments/:deployment_id", ({ params, request }) => {
      const path = parse(GetDeploymentByIdParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetDeploymentByIdQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const deployment = store.deployments.get(path.data.deployment_id);
      if (!deployment || deployment.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("dep.not_found", "deployment: not found"), {
          status: 404,
        });
      }
      return HttpResponse.json(deploymentResponse(deployment));
    }),

    http.post("*/deployments/:deployment_id/rollback", async ({ params, request }) => {
      const path = parse(RollbackDeploymentParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(RollbackDeploymentQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = (await readJson(request)) ?? {};
      const body = parse(RollbackDeploymentBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const target = store.deployments.get(path.data.deployment_id);
      if (!target || target.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("dep.not_found", "deployment: not found"), {
          status: 404,
        });
      }
      const project = store.projects.get(query.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("env.project_not_found", "project not found"), {
          status: 404,
        });
      }

      // Only a deployment to primary origins can be rolled back, and every
      // target must still be a primary origin of the project or the default
      // target.
      if (target.targets.some((row) => row.expiresAt !== null)) {
        return HttpResponse.json(
          errorBody(
            "dep.invalid",
            "deployment: a deployment to preview URLs cannot be rolled back",
          ),
          { status: 400 },
        );
      }
      const primaries = primaryOrigins(project);
      const removed = target.targets.find(
        (row) => row.origin !== DEFAULT_TARGET && !primaries.includes(row.origin),
      );
      if (removed) {
        return HttpResponse.json(
          errorBody(
            "proj.origin_not_allowed",
            `project: ${removed.origin} is not a primary origin`,
          ),
          { status: 403 },
        );
      }
      const release = store.releases.get(target.releaseId);
      if (release?.revokedAt) {
        return HttpResponse.json(errorBody("rel.revoked", "release: revoked"), { status: 409 });
      }

      const origins = target.targets.map((row) => row.origin);
      // The optimistic guard: the deployment the caller believes is the newest
      // one to any of the targets. A mismatch is a deploy that raced in.
      const rollbackData = body.data as Record<string, unknown>;
      const expectedRollbackId =
        typeof rollbackData.expected_deployment_id === "string"
          ? rollbackData.expected_deployment_id
          : undefined;
      if (expectedRollbackId !== undefined) {
        const newestToTargets = origins
          .map((origin) => newestDeploymentForOrigin(project.id, origin))
          .filter((deployment): deployment is DeploymentRecord => deployment !== undefined)
          .sort((a, b) => b.seq - a.seq)[0];
        if (newestToTargets && newestToTargets.id !== expectedRollbackId) {
          return HttpResponse.json(
            errorBody(
              "dep.conflict",
              "deployment: the newest deployment to the targets does not match expected_deployment_id",
              { deployment: deploymentResponse(newestToTargets) },
            ),
            { status: 409 },
          );
        }
      }
      const alreadyServed = origins.every(
        (origin) => newestDeploymentForOrigin(project.id, origin)?.releaseId === target.releaseId,
      );
      if (alreadyServed) {
        const newest = [...store.deployments.values()]
          .filter(
            (deployment) =>
              deployment.projectId === project.id &&
              deployment.releaseId === target.releaseId &&
              deployment.targets.some((row) => origins.includes(row.origin)),
          )
          .sort((a, b) => b.seq - a.seq)[0];
        if (newest) {
          return HttpResponse.json(deploymentResponse(newest), { status: 200 });
        }
      }

      const id = `dep_${shortId()}`;
      const record: DeploymentRecord = {
        id,
        projectId: project.id,
        releaseId: target.releaseId,
        targets: origins.sort().map((origin) => ({ origin, expiresAt: null })),
        reason: "rollback",
        message:
          typeof (body.data as Record<string, unknown>).message === "string"
            ? ((body.data as Record<string, unknown>).message as string)
            : null,
        rollbackTo: target.id,
        deployedAt: nowIso(),
        seq: ++store.lastSeq,
      };
      store.deployments.set(id, record);
      return HttpResponse.json(deploymentResponse(record), { status: 201 });
    }),

    // --- previews --------------------------------------------------------
    // A preview is written by a preview deployment above and lives until it
    // expires or is removed here. There is no create endpoint. Kept in its own
    // block so parallel PRs do not collide. Auth matches the deployments
    // endpoints: no bearer check, so the narrower preview token the CLI uses
    // works — the Go handlers are unimplemented stubs regardless.

    http.get("*/projects/:project_id/previews", ({ params, request }) => {
      const path = parse(ListPreviewsParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      // `limit` arrives as a string on the URL and the generated zod does not
      // coerce, so build it before validating, as the deployments list does.
      const record = queryRecord(request);
      const { limit, ...rest } = record;
      const query = parse(
        ListPreviewsQueryParams,
        { ...rest, ...(limit === undefined ? {} : { limit: Number(limit) }) },
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }

      const live = [...store.previews.values()]
        .filter((preview) => preview.projectId === path.data.project_id && previewIsLive(preview))
        .sort(compareNewestFirst)
        .map((preview) => ({
          origin: preview.origin,
          expires_at: preview.expiresAt,
          created_at: preview.createdAt,
        }));

      // Offset paging, like the schemas list: the opaque real cursor is the next
      // start index here, a page is `limit` rows from it, and a token the mock
      // never minted is rejected with req.invalid. `next_page_token` is the next
      // start when more rows remain, else null.
      const start = query.data.page_token === undefined ? 0 : Number(query.data.page_token);
      if (!Number.isInteger(start) || start < 0) {
        return HttpResponse.json(errorBody("req.invalid", "invalid page token"), { status: 400 });
      }
      const previews = live.slice(start, start + query.data.limit);
      const nextPageToken =
        start + query.data.limit < live.length ? String(start + query.data.limit) : null;
      const out = parse(
        ListPreviewsResponse,
        { previews, next_page_token: nextPageToken },
        "mock_response_invalid",
      );
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.post("*/projects/:project_id/previews/remove", async ({ params, request }) => {
      const path = parse(RemovePreviewParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(RemovePreviewBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      // Idempotent: a URL with no live preview answers 204 too. The preview row
      // is what admits the URL, so deleting it is the whole removal: the live
      // previews list and the live deployments view both stop showing the URL
      // because its preview is gone. The deployments that served it keep their
      // real target timestamps — removing a preview ends it, it does not rewrite
      // the history of what ran where and when.
      store.previews.delete(previewKey(path.data.project_id, body.data.origin));
      return new HttpResponse(null, { status: 204 });
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

      if (claimWindowClosed(project.createdAt)) {
        return HttpResponse.json(
          errorBody("proj.claim_window_expired", CLAIM_WINDOW_EXPIRED_MESSAGE),
          { status: 410 },
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
        return HttpResponse.json(
          errorBody("claim_challenge.not_found", "claim challenge not found"),
          {
            status: 404,
          },
        );
      }
      if (challenge.initiatingSecret !== token) {
        return HttpResponse.json(
          errorBody(
            "proj.permission_denied",
            "the presented project secret did not initiate this challenge",
          ),
          { status: 403 },
        );
      }
      // The grant, not the polled challenge, is the claim source of truth
      // (server order): a project claimed through any challenge reports
      // completed with its owning team, surviving challenge expiry and the
      // closed window alike. `authed` initiated this challenge (403 above),
      // so it is the challenge's own project.
      const claim = store.claims.get(challenge.projectId);
      let responseBody: GetClaimStatus200;
      if (claim) {
        responseBody = {
          status: "completed",
          team_id: claim.teamId,
          claimed_at: claim.claimedAt,
          dashboard_url: claim.dashboardUrl,
        };
        const completedOut = parse(GetClaimStatusResponse, responseBody, "mock_response_invalid");
        if (!completedOut.ok) {
          return completedOut.response;
        }
        return HttpResponse.json(completedOut.data);
      }
      // The closed claim window outranks challenge expiry for a pending
      // challenge: both are 410, but only challenge expiry recovers with a
      // fresh init, so the poller must learn the final refusal (mirrors the
      // server's check order).
      if (claimWindowClosed(authed.createdAt)) {
        return HttpResponse.json(
          errorBody("proj.claim_window_expired", CLAIM_WINDOW_EXPIRED_MESSAGE),
          { status: 410 },
        );
      }
      if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        return HttpResponse.json(
          errorBody("proj.claim_expired", "the claim challenge has expired"),
          { status: 410 },
        );
      }

      responseBody = { status: "pending" };
      const out = parse(GetClaimStatusResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // GET /projects/:project_id/claim/window — the claim page's countdown
    // read. Unauthenticated by contract: the browser runs it before the
    // developer signs in, and the challenge from the claim URL is the
    // capability. An unknown challenge is the only refusal, so a caller
    // learns nothing about which project ids exist.
    http.get("*/projects/:project_id/claim/window", ({ params, request }) => {
      const path = parse(GetClaimWindowParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetClaimWindowQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const challenge = store.claimChallenges.get(query.data.challenge_id);
      if (!challenge || challenge.projectId !== path.data.project_id) {
        return HttpResponse.json(
          errorBody("claim_challenge.not_found", "claim challenge not found"),
          {
            status: 404,
          },
        );
      }
      const project = store.projects.get(challenge.projectId);
      if (!project) {
        return HttpResponse.json(
          errorBody("claim_challenge.not_found", "claim challenge not found"),
          {
            status: 404,
          },
        );
      }

      // The window belongs to the project, not the challenge: a spent or
      // lapsed challenge still reports it, because the page shows the
      // deadline beside the outcome it is explaining.
      const expiresAt = new Date(new Date(project.createdAt).getTime() + CLAIM_WINDOW_MS);
      const responseBody: GetClaimWindow200 = {
        expires_at: expiresAt.toISOString(),
        expired: expiresAt.getTime() < Date.now(),
      };
      const out = parse(GetClaimWindowResponse, responseBody, "mock_response_invalid");
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
    http.post("*/users/query", async ({ request }) => {
      // The query body is JSON, so `limit` arrives already numeric — unlike the
      // query string this endpoint replaced, which needed it coerced by hand.
      const body = parse(QueryUsersBody, await request.json(), "invalid_request");
      if (!body.ok) {
        return body.response;
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

      const schemaBody = raw as unknown as GetSchemaById200Schema;
      const id = `sch_${shortId()}`;
      store.schemas.set(id, {
        id,
        projectId: query.data.project_id,
        objectType: schemaObjectType(schemaBody),
        createdAt: nowIso(),
        seq: ++store.lastSeq,
        body: schemaBody,
      });
      const responseBody: CreateSchema201 = { id };
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/schemas", ({ request }) => {
      // `expand` repeats (`expand=in_use&expand=…`) and is an array in the
      // spec; queryRecord keeps only its last value.
      const expand = new URL(request.url).searchParams.getAll("expand");
      const raw = {
        ...listQueryRecord(request),
        ...(expand.length === 0 ? {} : { expand }),
      };
      const query = parse(ListSchemasQueryParams, raw, "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const matching = [...store.schemas.values()]
        .filter((r) => r.projectId === query.data.project_id)
        .filter((r) => !query.data.object_type || r.objectType === query.data.object_type)
        .sort(compareNewestFirst);
      // The server's anti-join repeats none of the caller's filters, and only
      // object_type can correlate a suppressing row — so narrowing by
      // object_type before selecting the latest is equivalent, while narrowing
      // by kind is not: a newer revision of another kind still supersedes an
      // older one, and the schema drops out of a kind-filtered result entirely.
      const current =
        query.data.revisions === "latest" ? latestSchemaRevisions(matching) : matching;
      const records = current.filter(
        (r) => !query.data.kind || schemaKind(r.body) === query.data.kind,
      );
      const paged = pageOf(records, query.data.limit, query.data.page_token);
      if (!paged.ok) {
        return paged.response;
      }
      const { page, next } = paged;
      // The mock keeps no users, so no revision is ever in use.
      const inUse = query.data.expand?.includes("in_use") ? { in_use: false } : {};
      const responseBody: ListSchemas200 = {
        schemas: page.map((r) => ({
          id: r.id,
          schema: r.body,
          metadata: { created_at: r.createdAt, ...inUse },
        })),
        next_page_token: next,
      };
      return HttpResponse.json(responseBody);
    }),

    http.get("*/schemas/:id", ({ params, request }) => {
      const path = parse(GetSchemaByIdParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      // Flat-by-id: OpenAPI dropped required project_id; optional team_id may
      // still appear. Authz on the real server resolves ownership via RSI.
      const query = parse(GetSchemaByIdQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      const record = store.schemas.get(schemaID(path.data.id));
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetSchemaById200 = {
        id: record.id,
        schema: record.body,
        metadata: { created_at: record.createdAt },
      };
      return HttpResponse.json(responseBody);
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

      const key = schemaID(path.data.id);
      const record = store.schemas.get(key);
      if (!record) {
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
      const flowDefinition = body.data.flow_definition as unknown as Record<string, unknown>;
      const schema = resolveUserSchema(body.data.project_id, flowDefinition.user_schema);
      const invalid = invalidFlowDefinitionResponse(flowDefinition, schema);
      if (invalid) {
        return invalid;
      }

      const id = `flowdef_${shortId()}`;
      const now = nowIso();
      const record: FlowDefinitionRecord = {
        id,
        projectId: body.data.project_id,
        status: "active",
        createdAt: now,
        updatedAt: now,
        seq: ++store.lastSeq,
        // Stored as the `objectType` it names, like the server.
        body: schema?.objectType
          ? { ...flowDefinition, user_schema: schema.objectType }
          : flowDefinition,
      };
      store.flowDefinitions.set(id, record);
      const responseBody: CreateFlowDefinition201 = flowResponse(record);
      return HttpResponse.json(responseBody, { status: 201 });
    }),

    http.get("*/flow_definitions", ({ request }) => {
      const query = parse(ListFlowDefinitionsQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }

      // Newest by creation first, matching the server's
      // `created_at DESC, id DESC`.
      const matching = [...store.flowDefinitions.values()]
        .filter((record) => record.projectId === query.data.project_id)
        .filter((record) => !query.data.name || record.body.name === query.data.name)
        .sort(compareNewestFirst);
      // `name` is the column the server's anti-join correlates on, so
      // narrowing by name before selecting the latest is equivalent. The
      // purpose predicate is not: the server applies it to the outer query
      // only, so a flow whose newest revision lacks the purpose drops out
      // rather than falling back to an older matching revision — filter
      // after selecting the latest to match.
      const current = query.data.revisions === "latest" ? latestFlowRevisions(matching) : matching;
      const records = current.filter(
        (r) => !query.data.purpose || flowServesPurpose(r.body, query.data.purpose),
      );
      const responseBody: ListFlowDefinitions200 = {
        flow_definitions: records.map(flowResponse),
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

      // Flat-by-id: no project_id query — ownership is resolved via RSI+Check
      // on the real server.
      const record = store.flowDefinitions.get(path.data.id);
      if (!record) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      const responseBody: GetFlowDefinition200 = flowResponse(record);
      const out = parse(GetFlowDefinitionResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // --- identity provider connections -----------------------------------
    // The CLI's connection syncer publishes `.zitadel/idps/*.json` here. These
    // stand in for the Go service in the CLI specs and the SSO journey, so
    // they mirror its refusals: a CLI check the mock skipped would pass a test
    // the real service fails.

    http.post("*/idps", async ({ request }) => {
      const query = parse(CreateIdpQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(CreateIdpBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const definition = body.data.idp as unknown as Record<string, unknown>;
      // An oidc block names no endpoint or every one it needs. The server
      // refuses anything in between before it looks the slug up, and nests
      // the missing endpoints under details like any domain error's details.
      const missing = missingEndpoints(definition.oidc);
      if (missing.length > 0) {
        return HttpResponse.json(
          errorBody(
            "idp.endpoints_partial",
            "identity provider connection: the endpoints are partially set",
            { details: { missing } },
          ),
          { status: 400 },
        );
      }
      const slug = definition.slug as string;
      const now = nowIso();
      // A slug that already exists is revised under its own id, so everything
      // referencing the slug — the user schema, every flow step — keeps
      // pointing at the same connection.
      const existing = [...store.idps.values()].find(
        (record) => record.projectId === query.data.project_id && record.slug === slug,
      );
      if (existing) {
        const clash = immutableFieldClash(existing.body, definition);
        if (clash) {
          return HttpResponse.json(
            errorBody(
              "idp.field_immutable",
              "identity provider connection: the field is fixed for the life of the connection",
            ),
            { status: 400 },
          );
        }
      }
      const record: IdpConnectionRecord = existing
        ? {
            ...existing,
            revisionId: `idprev_${shortId()}`,
            updatedAt: now,
            seq: ++store.lastSeq,
            body: definition,
          }
        : {
            id: `idp_${shortId()}`,
            revisionId: `idprev_${shortId()}`,
            projectId: query.data.project_id,
            slug,
            createdAt: now,
            updatedAt: now,
            seq: ++store.lastSeq,
            body: definition,
          };
      store.idps.set(record.id, record);

      const responseBody = idpResponse(record);
      const out = parse(CreateIdpResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: existing ? 200 : 201 });
    }),

    http.post("*/idps/query", async ({ request }) => {
      const query = parse(QueryIdpsQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      // The body carries filters, sorting and paging. Accepting it unread
      // would let a CLI slug filter appear to work while returning every
      // connection in the project.
      const raw = (await readJson(request)) ?? {};
      const body = parse(QueryIdpsBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const ascending = body.data.sorting?.direction !== "desc";
      const field = body.data.sorting?.field ?? "created_at";
      const records = [...store.idps.values()]
        .filter((record) => record.projectId === query.data.project_id)
        .filter((record) => matchesIdpFilters(record, body.data.filter))
        .sort((a, b) => {
          const order = field === "slug" ? a.slug.localeCompare(b.slug) : a.seq - b.seq;
          // `seq` stands in for created_at; ids break ties either way.
          return ascending ? order : -order;
        })
        .slice(0, body.data.limit ?? undefined);
      const responseBody = { idps: records.map(idpResponse), next_page_token: null };
      const out = parse(QueryIdpsResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.get("*/idps/:id", ({ params, request }) => {
      const path = parse(GetIdpByIdParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetIdpByIdQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const record = store.idps.get(path.data.id);
      if (!record || record.projectId !== query.data.project_id) {
        return HttpResponse.json(
          errorBody("idp.not_found", "identity provider connection: not found"),
          { status: 404 },
        );
      }
      const out = parse(GetIdpByIdResponse, idpResponse(record), "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // --- operation policies ---------------------------------------------------
    // `setup` publishes the password policy here, a release build publishes
    // `.zitadel/policies/*.json` through the same revision helper, and
    // `policies list|get` read them back. They mirror the server's answers: an
    // unknown setting is malformed (`req.invalid` there), and a minimum above
    // the maximum fails the template's config rule (`pol.invalid`).

    http.post("*/policies", async ({ request }) => {
      const query = parse(PublishPolicyQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      // Like the server's decoder: unknown settings are refused, while an
      // extra top-level key (the file's `$schema`) is ignored.
      const body = parse(policyConfigSchema.loose(), raw, "req.invalid");
      if (!body.ok) {
        return body.response;
      }
      const { operation, config } = body.data;
      if (policyRuleViolated(config)) {
        return HttpResponse.json(
          errorBody("pol.invalid", "policy: invalid", {
            details: { violations: [MIN_ABOVE_MAX_VIOLATION] },
          }),
          { status: 400 },
        );
      }
      const { record, revision } = publishPolicyRevision(query.data.project_id, operation, config);

      const out = parse(
        PublishPolicyResponse,
        policyResponse(record, revision),
        "mock_response_invalid",
      );
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: 201 });
    }),

    // A dry run: nothing is read or stored. The config is checked as a
    // publish checks it, then evaluated as the server's password set would.
    http.post("*/policies/evaluate", async ({ request }) => {
      const query = parse(EvaluatePolicyQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(EvaluatePolicyStrictBody, raw, "req.invalid");
      if (!body.ok) {
        return body.response;
      }
      if (policyRuleViolated(body.data.config)) {
        return HttpResponse.json(
          errorBody("pol.invalid", "policy: invalid", {
            details: { violations: [MIN_ABOVE_MAX_VIOLATION] },
          }),
          { status: 400 },
        );
      }
      const decision = evaluatePasswordSet(body.data.config, body.data.input.password, {
        self_service: body.data.facts?.self_service ?? true,
        history_matches: body.data.facts?.history_matches ?? [],
      });
      const out = parse(EvaluatePolicyResponse, decision, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.get("*/policies", ({ request }) => {
      const query = parse(ListPoliciesQueryParams, listQueryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      // First published first; `seq` stands in for created_at.
      const records = [...store.policies.values()]
        .filter((record) => record.projectId === query.data.project_id)
        .filter((record) => !query.data.operation || record.operation === query.data.operation)
        .sort((a, b) => a.seq - b.seq);
      const paged = pageOf(records, query.data.limit, query.data.page_token);
      if (!paged.ok) {
        return paged.response;
      }
      const responseBody = {
        policies: paged.page.map((record) => policyResponse(record, newestRevision(record))),
        next_page_token: paged.next ?? null,
      };
      const out = parse(ListPoliciesResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // Ahead of `*/policies/:policy_id`, which would otherwise read "revisions"
    // as a policy id.
    http.get("*/policies/revisions/:revision_id", ({ params, request }) => {
      const path = parse(GetPolicyRevisionParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetPolicyRevisionQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      for (const record of store.policies.values()) {
        if (record.projectId !== query.data.project_id) continue;
        const revision = record.revisions.find((r) => r.revisionId === path.data.revision_id);
        if (revision) {
          const out = parse(
            GetPolicyRevisionResponse,
            policyResponse(record, revision),
            "mock_response_invalid",
          );
          return out.ok ? HttpResponse.json(out.data) : out.response;
        }
      }
      return HttpResponse.json(POLICY_NOT_FOUND, { status: 404 });
    }),

    http.get("*/policies/:policy_id", ({ params, request }) => {
      const path = parse(GetPolicyParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetPolicyQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const record = store.policies.get(path.data.policy_id);
      if (!record || record.projectId !== query.data.project_id) {
        return HttpResponse.json(POLICY_NOT_FOUND, { status: 404 });
      }
      const out = parse(
        GetPolicyResponse,
        policyResponse(record, newestRevision(record)),
        "mock_response_invalid",
      );
      return out.ok ? HttpResponse.json(out.data) : out.response;
    }),

    http.get("*/policies/:policy_id/revisions", ({ params, request }) => {
      const path = parse(ListPolicyRevisionsParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(
        ListPolicyRevisionsQueryParams,
        listQueryRecord(request),
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }
      const record = store.policies.get(path.data.policy_id);
      if (!record || record.projectId !== query.data.project_id) {
        return HttpResponse.json(POLICY_NOT_FOUND, { status: 404 });
      }
      const paged = pageOf(
        [...record.revisions].reverse(),
        query.data.limit,
        query.data.page_token,
      );
      if (!paged.ok) {
        return paged.response;
      }
      const responseBody = {
        revisions: paged.page.map((revision) => policyResponse(record, revision)),
        next_page_token: paged.next ?? null,
      };
      const out = parse(ListPolicyRevisionsResponse, responseBody, "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
    }),

    // --- variables ---------------------------------------------------------
    // Where a connection's `${{ NAME }}` references resolve from. The CLI
    // publishes the client id and secret here, so without them a scaffolded
    // provider has no credentials and sign-in fails at the token endpoint.

    // Registered ahead of `*/variables`, which would otherwise match it. The
    // server answers 501 until it stores frozen sets, and so does the mock.
    http.get("*/deployments/:deploymentId/variables", () =>
      HttpResponse.json(errorBody("not_implemented", "This feature is not implemented yet."), {
        status: 501,
      }),
    ),

    http.get("*/variables", ({ request }) => {
      const query = parse(GetVariablesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const body = variablesResponse(
        store.variables,
        query.data.project_id,
        variableKinds(query.data.kind),
      );
      const out = parse(GetVariablesResponse, body, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // One variable by name, which `variables get` and `variables delete`
    // address directly.
    http.get("*/variables/:variableName", ({ request, params }) => {
      const path = parse(
        GetVariableParams,
        { variable_name: String(params.variableName) },
        "invalid_request",
      );
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetVariableQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const body = variablesResponse(
        store.variables,
        query.data.project_id,
        variableKinds(query.data.kind),
      )[path.data.variable_name];
      if (body === undefined) {
        return HttpResponse.json(errorBody("var.not_found", "variable not found"), { status: 404 });
      }
      const out = parse(GetVariableResponse, body, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    http.delete("*/variables/:variableName", ({ request, params }) => {
      const path = parse(
        DeleteVariableParams,
        { variable_name: String(params.variableName) },
        "invalid_request",
      );
      if (!path.ok) {
        return path.response;
      }
      const query = parse(DeleteVariableQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      // A removal naming a kind leaves the other kind's value.
      let removed = false;
      for (const kind of variableKinds(query.data.kind)) {
        const owned = store.variables.get(variableOwner(query.data.project_id, kind));
        removed = (owned?.delete(path.data.variable_name) ?? false) || removed;
      }
      if (!removed) {
        return HttpResponse.json(errorBody("var.not_found", "variable not found"), { status: 404 });
      }
      return new HttpResponse(null, { status: 204 });
    }),

    http.patch("*/variables", async ({ request }) => {
      const query = parse(UpdateVariablesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(UpdateVariablesBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }

      const projectId = query.data.project_id;
      const kinds = variableKinds(query.data.kind);
      const owned = (kind: VariableKind) => {
        const owner = variableOwner(projectId, kind);
        const held = store.variables.get(owner) ?? new Map<string, VariableRecord>();
        store.variables.set(owner, held);
        return held;
      };
      // RFC 7386: a name present is written, `null` removes it, and a name
      // absent is left alone. Without a kind, a plain value is written for
      // both kinds, and a secret for primary only, removing the preview value.
      for (const [name, value] of Object.entries(body.data as Record<string, unknown>)) {
        if (value === null) {
          for (const kind of kinds) {
            owned(kind).delete(name);
          }
        } else if (typeof value === "object") {
          const input = value as { value: string | number | boolean; secret: boolean };
          const kindless = input.secret && query.data.kind === undefined;
          for (const kind of kindless ? (["primary"] as const) : kinds) {
            owned(kind).set(name, { value: input.value, secret: input.secret });
          }
          if (kindless) {
            owned("preview").delete(name);
          }
        } else {
          for (const kind of kinds) {
            owned(kind).set(name, { value: value as string | number | boolean, secret: false });
          }
        }
      }
      // 200 with the variables read back, including what the write did not touch.
      const response = variablesResponse(store.variables, projectId, kinds);
      const out = parse(UpdateVariablesResponse, response, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),
  ];
}
