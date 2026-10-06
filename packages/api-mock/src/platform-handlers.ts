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

import type {
  CompleteClaim200,
  CreateFlowDefinition201,
  CreateProject201,
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
  AddAllowedOriginBody,
  AddAllowedOriginParams,
  AddAllowedOriginResponse,
  CompleteClaimResponse,
  CreateDeploymentBody,
  CreateDeploymentQueryParams,
  CreateDeploymentResponse,
  CreateFlowDefinitionBody,
  CreateIdpBody,
  CreateIdpQueryParams,
  CreateIdpResponse,
  CreateProjectBody,
  CreateReleaseBody,
  CreateReleaseQueryParams,
  CreateReleaseResponse,
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
  GetDeploymentByIdResponse,
  GetDeploymentVariablesParams,
  GetDeploymentVariablesQueryParams,
  GetDeploymentVariablesResponse,
  GetFlowDefinitionParams,
  GetFlowDefinitionResponse,
  GetIdpByIdParams,
  GetIdpByIdQueryParams,
  GetIdpByIdResponse,
  GetProjectParams,
  GetProjectResponse,
  GetReleaseByIdParams,
  GetReleaseByIdQueryParams,
  GetReleaseByIdResponse,
  GetSchemaByIdParams,
  GetSchemaByIdQueryParams,
  GetVariableParams,
  GetVariableQueryParams,
  GetVariableResponse,
  GetVariablesQueryParams,
  GetVariablesResponse,
  InitClaimParams,
  ListDeploymentsQueryParams,
  ListDeploymentsResponse,
  ListFlowDefinitionsQueryParams,
  ListFlowDefinitionsResponse,
  ListOriginsQueryParams,
  ListOriginsResponse,
  ListReleasesQueryParams,
  ListReleasesResponse,
  ListSchemasQueryParams,
  QueryIdpsBody,
  QueryIdpsQueryParams,
  QueryIdpsResponse,
  QueryUsersBody,
  RemoveAllowedOriginBody,
  RemoveAllowedOriginParams,
  RemoveOriginBody,
  RemoveOriginQueryParams,
  RevokeReleaseParams,
  RevokeReleaseQueryParams,
  RevokeReleaseResponse,
  RollbackDeploymentBody,
  RollbackDeploymentQueryParams,
  RollbackDeploymentResponse,
  SetProjectClassBody,
  SetProjectClassParams,
  SetProjectClassResponse,
  UpdateVariablesBody,
  UpdateVariablesQueryParams,
  UpdateVariablesResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { validateFlowDefinition } from "@zitadel/config/validate";
import {
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
} from "@zitadel/config/defaults";
import { http, HttpResponse } from "msw";
import type { z } from "zod";

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
 * Server-side record for a project. Strict superset of the spec response
 * types (`CreateProject201`, `GetProject200`): includes the server-only
 * secrets and `updatedAt`. Handlers project from this record to the right
 * wire shape at the boundary.
 */
type ProjectRecord = {
  id: string;
  name: string;
  class: ProjectClass;
  projectSecret: string;
  previewSecret: string;
  previewToken: string;
  allowedOrigins: AllowedOriginRecord[];
  createdAt: string;
  updatedAt: string;
};

type ProjectClass = "sandbox" | "production";
type OriginKind = "primary" | "preview";

/** One allowlist entry. A `primary` admits requests; a `preview` only bounds what a preview deploy may register. */
type AllowedOriginRecord = { pattern: string; kind: OriginKind };

/** An immutable snapshot of revisions, keyed per project by its content hash. */
type ReleaseRecord = {
  id: string;
  projectId: string;
  contentHash: string;
  pointers: { kind: "schema" | "flow_definition" | "branding"; handle: string; revision_id: string }[];
  message?: string;
  gitSha?: string;
  gitDirty: boolean;
  createdAt: string;
  seq: number;
  revokedAt?: string;
};

/**
 * One row of the deployment log: a release made live on one target. `""` is
 * the project default. The variables the row runs are frozen on it, so an
 * edit of the store reaches nothing already deployed.
 */
type DeploymentRecord = {
  id: string;
  projectId: string;
  deployId: string;
  origin: string;
  releaseId: string;
  reason: "deploy" | "promote" | "rollback";
  message?: string;
  rollbackOf?: string;
  deployedAt: string;
  seq: number;
  variables: Map<string, VariableRecord>;
};

/** The row that admits requests from one live preview URL. */
type OriginRecord = { projectId: string; origin: string; expiresAt: string; createdAt: string };

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
 * One variable value. `secret` decides what a read may say: a secret reports
 * that a value is held and withholds it (ADR 062 §7), so the stored value is
 * only ever resolved into a connection, never returned.
 */
type VariableRecord = { value: string | number | boolean; secret: boolean };

type Store = {
  projects: Map<string, ProjectRecord>;
  schemas: Map<string, SchemaRecord>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
  idps: Map<string, IdpConnectionRecord>;
  /**
   * `applies_to` bucket -> variable name -> value. `all` is what every deploy
   * freezes; `preview` overrides it on a preview deploy. See
   * {@link variableOwner}.
   */
  variables: Map<string, Map<string, VariableRecord>>;
  releases: Map<string, ReleaseRecord>;
  deployments: Map<string, DeploymentRecord>;
  /** Keyed by {@link originKey}. */
  origins: Map<string, OriginRecord>;
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
    variables: new Map(),
    releases: new Map(),
    deployments: new Map(),
    origins: new Map(),
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
      ...(r.body as Record<string, unknown>),
      // After the spread: an update that omits `status` keeps the stored one,
      // which is what the endpoint documents.
      status: r.status,
    } as unknown as GetFlowDefinition200['flow_definition'],
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
    body: getDefaultLoginFlow({ userSchemaUrl: schemaId }) as unknown as Record<string, unknown>,
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
function immutableFieldClash(before: Record<string, unknown>, after: Record<string, unknown>): string | undefined {
  for (const field of ["protocol", "subject_claim"] as const) {
    if (before[field] !== undefined && before[field] !== after[field]) {
      return field;
    }
  }
  // The authority is the issuer for OIDC, and the token endpoint with the
  // userinfo endpoint for OAuth 2.0.
  for (const [block, fields] of [
    ["oidc", ["issuer"]],
    ["oauth2", ["token_endpoint", "userinfo_endpoint"]],
  ] as const) {
    const was = before[block];
    const now = after[block];
    if (!isObject(was) || !isObject(now)) {
      continue;
    }
    for (const field of fields) {
      if (was[field] !== undefined && was[field] !== now[field]) {
        return `${block}.${field}`;
      }
    }
  }
  return undefined;
}

/** The bucket a variables request addresses: the project's `all` or `preview` values. */
function variableOwner(projectId: string, appliesTo: "all" | "preview"): string {
  return `${projectId}:${appliesTo}`;
}

function originKey(projectId: string, origin: string): string {
  return `${projectId}\u0000${origin.toLowerCase()}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `*` matches one or more characters, none of them a dot; everything else is literal. */
function patternMatches(pattern: string, origin: string): boolean {
  const source = pattern.toLowerCase().split("*").map(escapeRegExp).join("[^.]+");
  return new RegExp(`^${source}$`).test(origin.toLowerCase());
}

/** The entry admitting `origin`, a literal beating a wildcard. */
function matchAllowedOrigin(
  allowed: AllowedOriginRecord[],
  origin: string,
): AllowedOriginRecord | undefined {
  const literal = allowed.find(
    (entry) => !entry.pattern.includes("*") && entry.pattern.toLowerCase() === origin.toLowerCase(),
  );
  if (literal) {
    return literal;
  }
  return allowed.find((entry) => entry.pattern.includes("*") && patternMatches(entry.pattern, origin));
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const ORIGIN_SHAPE = /^https?:\/\/[^/?#\s]+$/i;
/** Hosts where anyone can mint a hostname, so a wildcard needs a tenant-unique label beside it. */
const SHARED_HOSTS = ["vercel.app", "netlify.app", "pages.dev", "workers.dev"];

type PatternCheck =
  | { ok: true; check: { status: "ok" | "warning"; code?: string; message: string } }
  | { ok: false; code: string; message: string };

/**
 * The lint a pattern passes when it is saved. Rejections apply to a
 * `production` project; a wildcard on a host the mock does not know is
 * accepted with a warning on either class.
 */
function lintPattern(cls: ProjectClass, kind: OriginKind, pattern: string): PatternCheck {
  if (!ORIGIN_SHAPE.test(pattern)) {
    return { ok: false, code: "req.invalid", message: "pattern must be scheme://host[:port]" };
  }
  const wildcard = pattern.includes("*");
  if (cls === "production") {
    if (LOOPBACK_ORIGIN.test(pattern)) {
      return {
        ok: false,
        code: "proj.origin_not_permitted_for_class",
        message: "a production project does not serve loopback origins",
      };
    }
    if (kind === "primary" && wildcard) {
      return {
        ok: false,
        code: "proj.origin_not_permitted_for_class",
        message: "a primary pattern on a production project must be an exact origin",
      };
    }
  }
  if (!wildcard) {
    return { ok: true, check: { status: "ok", message: "exact origin" } };
  }
  const host = pattern.replace(/^https?:\/\//i, "").replace(/:\d+$/, "");
  const shared = SHARED_HOSTS.find((suffix) => host.toLowerCase().endsWith(`.${suffix}`));
  if (!shared) {
    return {
      ok: true,
      check: {
        status: "warning",
        code: "origin_host_unknown",
        message: `${host.replace(/^[^.]*\./, "")} is not in the host list; the label could not be checked`,
      },
    };
  }
  const label = host.slice(0, -(shared.length + 1)).replaceAll("*", "").replace(/^[.-]+|[.-]+$/g, "");
  if (label === "") {
    if (cls === "production") {
      return {
        ok: false,
        code: "proj.origin_unbounded",
        message: `${host} has no literal label on a shared host, so a leaked preview credential could register any URL under ${shared}`,
      };
    }
    return { ok: true, check: { status: "warning", code: "origin_unbounded", message: `${host} has no literal label on ${shared}` } };
  }
  return { ok: true, check: { status: "ok", message: `bounded by label \`${label}\`` } };
}

/** Every pattern of the project that would fail the lint under `cls`. */
function patternsFailing(project: ProjectRecord, cls: ProjectClass): string[] {
  return project.allowedOrigins
    .filter((entry) => !lintPattern(cls, entry.kind, entry.pattern).ok)
    .map((entry) => entry.pattern);
}

function contentHash(pointers: { kind: string; revision_id: string }[]): string {
  const pairs = pointers.map((p) => `${p.kind}:${p.revision_id}`).sort();
  return createHash("sha256").update(pairs.join("\n")).digest("hex");
}

/** The handle a revision is pinned under: the resource's own identifying field. */
function pointerHandle(kind: string, revisionId: string): string {
  if (kind === "schema") {
    return store.schemas.get(revisionId)?.objectType ?? revisionId;
  }
  if (kind === "flow_definition") {
    const name = store.flowDefinitions.get(revisionId)?.body.name;
    return typeof name === "string" ? name : revisionId;
  }
  return "default";
}

function releaseResponse(release: ReleaseRecord): Record<string, unknown> {
  return {
    id: release.id,
    project_id: release.projectId,
    content_hash: release.contentHash,
    metadata: {
      message: release.message ?? null,
      git_sha: release.gitSha ?? null,
      git_dirty: release.gitDirty,
      created_at: release.createdAt,
      created_by: null,
      created_by_type: null,
    },
    pointers: release.pointers,
    revoked_at: release.revokedAt ?? null,
  };
}

/**
 * The release a `rel_` id or a `sha256:` / bare hex digest prefix names.
 * An ambiguous short digest is refused, as the server does.
 */
function resolveRelease(
  projectId: string,
  ref: string,
): { ok: true; release: ReleaseRecord } | { ok: false; response: HttpResponse<ErrorBody> } {
  const inProject = [...store.releases.values()].filter((r) => r.projectId === projectId);
  if (ref.startsWith("rel_")) {
    const release = inProject.find((r) => r.id === ref);
    return release
      ? { ok: true, release }
      : { ok: false, response: HttpResponse.json(errorBody("rel.not_found", "release not found"), { status: 404 }) };
  }
  const digest = ref.replace(/^sha256:/, "").toLowerCase();
  if (digest.length < 12 || !/^[0-9a-f]+$/.test(digest)) {
    return { ok: false, response: HttpResponse.json(errorBody("rel.not_found", "release not found"), { status: 404 }) };
  }
  const matches = inProject.filter((r) => r.contentHash.startsWith(digest));
  if (matches.length > 1) {
    return {
      ok: false,
      response: HttpResponse.json(errorBody("rel.ambiguous", "the digest matches more than one release"), { status: 400 }),
    };
  }
  const [match] = matches;
  return match
    ? { ok: true, release: match }
    : { ok: false, response: HttpResponse.json(errorBody("rel.not_found", "release not found"), { status: 404 }) };
}

function liveOrigin(projectId: string, origin: string): OriginRecord | undefined {
  const row = store.origins.get(originKey(projectId, origin));
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }
  return row;
}

/** The newest row for one target, or undefined when nothing was deployed there. */
function newestDeployment(projectId: string, origin: string): DeploymentRecord | undefined {
  let newest: DeploymentRecord | undefined;
  for (const row of store.deployments.values()) {
    if (row.projectId === projectId && row.origin === origin && (!newest || row.seq > newest.seq)) {
      newest = row;
    }
  }
  return newest;
}

/** Every row of the project, newest first. */
function deploymentHistory(projectId: string): DeploymentRecord[] {
  return [...store.deployments.values()]
    .filter((row) => row.projectId === projectId)
    .sort((a, b) => b.seq - a.seq);
}

/**
 * The values a deploy freezes: the `all` bucket, overlaid by `preview` values
 * when every target is a preview origin. A secret with no preview value on a
 * preview deploy is served the production one, which is worth a warning.
 */
function frozenVariables(
  projectId: string,
  preview: boolean,
): { values: Map<string, VariableRecord>; warnings: string[] } {
  const values = new Map(store.variables.get(variableOwner(projectId, "all")) ?? []);
  const warnings: string[] = [];
  if (!preview) {
    return { values, warnings };
  }
  const overrides = store.variables.get(variableOwner(projectId, "preview")) ?? new Map<string, VariableRecord>();
  for (const [name, held] of values) {
    if (held.secret && !overrides.has(name)) {
      warnings.push(`${name} has no preview value — serving the production one`);
    }
  }
  for (const [name, held] of overrides) {
    values.set(name, held);
  }
  return { values, warnings };
}

function sameVariables(a: Map<string, VariableRecord>, b: Map<string, VariableRecord>): boolean {
  const serialise = (m: Map<string, VariableRecord>) =>
    JSON.stringify([...m.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return serialise(a) === serialise(b);
}

function deploymentResponse(
  row: DeploymentRecord,
  options: { live?: boolean; expandRelease?: boolean } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: row.id,
    project_id: row.projectId,
    deploy_id: row.deployId,
    origin: row.origin,
    release_id: row.releaseId,
    deployed_at: row.deployedAt,
    metadata: {
      reason: row.reason,
      message: row.message ?? null,
      rollback_of: row.rollbackOf ?? null,
      deployed_by: null,
      deployed_by_type: null,
    },
  };
  if (options.live && row.origin !== "") {
    body.expires_at = liveOrigin(row.projectId, row.origin)?.expiresAt ?? null;
  }
  if (options.expandRelease) {
    const release = store.releases.get(row.releaseId);
    if (release) {
      body.release = releaseResponse(release);
    }
  }
  return body;
}

function appendDeployment(input: {
  projectId: string;
  deployId: string;
  origin: string;
  releaseId: string;
  reason: DeploymentRecord["reason"];
  message?: string;
  rollbackOf?: string;
  variables: Map<string, VariableRecord>;
}): DeploymentRecord {
  const row: DeploymentRecord = {
    id: `dep_${shortId()}`,
    projectId: input.projectId,
    deployId: input.deployId,
    origin: input.origin,
    releaseId: input.releaseId,
    reason: input.reason,
    message: input.message,
    rollbackOf: input.rollbackOf,
    deployedAt: nowIso(),
    seq: ++store.lastSeq,
    variables: new Map(input.variables),
  };
  store.deployments.set(row.id, row);
  return row;
}

function deployResponse(
  deployId: string,
  releaseId: string,
  rows: DeploymentRecord[],
  warnings: string[],
): Record<string, unknown> {
  return {
    deploy_id: deployId,
    release_id: releaseId,
    targets: rows.map((row) => row.origin),
    deployments: rows.map((row) => deploymentResponse(row)),
    warnings,
  };
}

function projectResponse(project: ProjectRecord): GetProject200 {
  return {
    id: project.id,
    name: project.name,
    class: project.class,
    allowed_origins: project.allowedOrigins,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

/** A refusal from {@link admitFlow}: the status and the spec error envelope. */
export type FlowRefusal = { status: number; body: ErrorBody };

/**
 * The gate every flow start passes on the server, run against the platform
 * store: the request's `Origin` must match an allowlist pattern (a `preview`
 * match also needs a live row), and an `X-Zitadel-Release` pin may only
 * select a release already deployed to the matched target on a `production`
 * project. A project the store does not hold is not gated — the browser
 * fixtures run without one.
 */
export function admitFlow(input: {
  projectId: string;
  origin: string | null;
  release: string | null;
}): FlowRefusal | null {
  const project = store.projects.get(input.projectId);
  if (!project) {
    return null;
  }
  const origin = (input.origin ?? "").trim();
  if (origin !== "" && origin !== "null" && project.allowedOrigins.length > 0) {
    const matched = matchAllowedOrigin(project.allowedOrigins, origin);
    if (!matched) {
      return {
        status: 403,
        body: errorBody("proj.origin_not_allowed", "the request origin is not allowed for this project", { origin }),
      };
    }
    if (matched.kind === "preview" && !liveOrigin(project.id, origin)) {
      return {
        status: 403,
        body: errorBody(
          "proj.preview_not_live",
          "this preview is no longer live — push the branch again or run `zitadel preview`",
          { origin },
        ),
      };
    }
  }
  const pin = (input.release ?? "").trim();
  if (pin === "") {
    return null;
  }
  const resolved = resolveRelease(project.id, pin);
  if (!resolved.ok) {
    return pin.startsWith("rel_") || !/^(sha256:)?[0-9a-f]{12,}$/i.test(pin)
      ? { status: 404, body: errorBody("rel.not_found", "release not found", { release: pin }) }
      : { status: 400, body: errorBody("rel.ambiguous", "the digest matches more than one release", { release: pin }) };
  }
  if (resolved.release.revokedAt) {
    return { status: 409, body: errorBody("rel.revoked", "the release is revoked", { release: pin }) };
  }
  if (project.class !== "production") {
    return null;
  }
  const target = origin === "" || origin === "null" ? "" : origin;
  const deployedHere = [...store.deployments.values()].some(
    (row) => row.projectId === project.id && row.origin === target && row.releaseId === resolved.release.id,
  );
  if (!deployedHere) {
    return {
      status: 409,
      body: errorBody(
        "rel.not_deployed",
        "this build pins a release this target no longer serves — redeploy the app",
        { release: pin, origin: target },
      ),
    };
  }
  return null;
}

/** What a read of one owner says: a value, or that a secret is held. */
function variablesResponse(owned: Map<string, VariableRecord>): Record<string, unknown> {
  // A secret says that a value is held and withholds it (ADR 062 §7):
  // returning the plaintext would defeat the encryption it stands for.
  return Object.fromEntries(
    [...owned.entries()].map(([name, held]) => [name, held.secret ? { secret: true } : held.value]),
  );
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
  claimChallenges: number;
  claims: number;
  projectIds: string[];
  schemaIds: string[];
  flowDefinitionIds: string[];
  /** Connection slugs, which is what schemas and flows reference. */
  idpSlugs: string[];
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
    claimChallenges: store.claimChallenges.size,
    claims: store.claims.size,
    projectIds: [...store.projects.keys()],
    schemaIds: [...store.schemas.keys()],
    flowDefinitionIds: [...store.flowDefinitions.keys()],
    idpSlugs: [...store.idps.values()].map((record) => record.slug),
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
    return { status: 404, body: errorBody("claim_challenge.not_found", "claim challenge not found") };
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
        class: "sandbox",
        projectSecret: `sk_proj_${id.replaceAll("-", "")}_full`,
        previewSecret: `sk_proj_${id.replaceAll("-", "")}_preview`,
        previewToken: `sk_preview_${id.replaceAll("-", "")}`,
        allowedOrigins: body.data.allowed_origins ?? [],
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
        class: project.class,
        project_secret: project.projectSecret,
        preview_secret: project.previewSecret,
        preview_token: project.previewToken,
        allowed_origins: project.allowedOrigins,
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
      const out = parse(GetProjectResponse, projectResponse(project), "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // --- allowlist and class -----------------------------------------------
    // Patterns are project state, changed deliberately rather than as a side
    // effect of shipping, and the one write a preview credential must never
    // be able to make.

    http.post("*/projects/:project_id/allowed_origins", async ({ params, request }) => {
      const path = parse(AddAllowedOriginParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(AddAllowedOriginBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "project not found"), { status: 404 });
      }
      if (project.allowedOrigins.some((entry) => entry.pattern === body.data.pattern)) {
        return HttpResponse.json(errorBody("req.invalid", "the pattern is already allowed"), { status: 400 });
      }
      const lint = lintPattern(project.class, body.data.kind, body.data.pattern);
      if (!lint.ok) {
        return HttpResponse.json(errorBody(lint.code, lint.message, { pattern: body.data.pattern }), {
          status: 400,
        });
      }
      project.allowedOrigins.push({ pattern: body.data.pattern, kind: body.data.kind });
      project.updatedAt = nowIso();
      const out = parse(
        AddAllowedOriginResponse,
        { pattern: body.data.pattern, kind: body.data.kind, check: lint.check },
        "mock_response_invalid",
      );
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: 201 });
    }),

    http.post("*/projects/:project_id/allowed_origins/remove", async ({ params, request }) => {
      const path = parse(RemoveAllowedOriginParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(RemoveAllowedOriginBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "project not found"), { status: 404 });
      }
      const index = project.allowedOrigins.findIndex((entry) => entry.pattern === body.data.pattern);
      if (index < 0) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      project.allowedOrigins.splice(index, 1);
      project.updatedAt = nowIso();
      return new HttpResponse(null, { status: 204 });
    }),

    http.post("*/projects/:project_id/class", async ({ params, request }) => {
      const path = parse(SetProjectClassParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(SetProjectClassBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const project = store.projects.get(path.data.project_id);
      if (!project) {
        return HttpResponse.json(errorBody("proj.not_found", "project not found"), { status: 404 });
      }
      if (body.data.class === "production") {
        // Promotion re-checks every pattern: what sandbox tolerated has to
        // pass the production rules before real users can be behind it.
        const offenders = patternsFailing(project, "production");
        if (offenders.length > 0) {
          return HttpResponse.json(
            errorBody("proj.origin_not_permitted_for_class", "patterns do not pass the production rules", {
              patterns: offenders,
            }),
            { status: 400 },
          );
        }
      } else if (project.class === "production" && !body.data.confirm) {
        return HttpResponse.json(
          errorBody("req.invalid", "demoting a production project lets loopback origins back in; confirm it"),
          { status: 400 },
        );
      }
      project.class = body.data.class;
      project.updatedAt = nowIso();
      const out = parse(SetProjectClassResponse, projectResponse(project), "mock_response_invalid");
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
        return HttpResponse.json(errorBody("claim_challenge.not_found", "claim challenge not found"), {
          status: 404,
        });
      }
      if (challenge.initiatingSecret !== token) {
        return HttpResponse.json(
          errorBody("proj.permission_denied", "the presented project secret did not initiate this challenge"),
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
        return HttpResponse.json(errorBody("claim_challenge.not_found", "claim challenge not found"), {
          status: 404,
        });
      }
      const project = store.projects.get(challenge.projectId);
      if (!project) {
        return HttpResponse.json(errorBody("claim_challenge.not_found", "claim challenge not found"), {
          status: 404,
        });
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
      // Same `limit` coercion caveat as `GET /users` above: URLs carry strings
      // and the generated zod does not coerce, so out-of-range limits are
      // rejected by the schema (1-100) rather than silently normalised.
      const { limit, ...rest } = queryRecord(request);
      const raw = { ...rest, ...(limit === undefined ? {} : { limit: Number(limit) }) };
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
      // The real cursor is opaque; the mock's is the next start index. A token
      // it never minted is rejected with req.invalid, like the real server.
      const start = query.data.page_token === undefined ? 0 : Number(query.data.page_token);
      if (!Number.isInteger(start) || start < 0) {
        return HttpResponse.json(errorBody("req.invalid", "invalid page token"), { status: 400 });
      }
      const page = records.slice(start, start + query.data.limit);
      const next =
        start + query.data.limit < records.length ? String(start + query.data.limit) : undefined;
      const responseBody: ListSchemas200 = {
        schemas: page.map((r) => ({
          id: r.id,
          schema: r.body,
          metadata: { created_at: r.createdAt },
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
      const invalid = invalidFlowDefinitionResponse(
        body.data.flow_definition as Record<string, unknown>,
      );
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
        body: body.data.flow_definition as unknown as Record<string, unknown>,
      };
      store.flowDefinitions.set(id, record);
      const responseBody: CreateFlowDefinition201 = flowResponse(record);
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
      const current =
        query.data.revisions === "latest" ? latestFlowRevisions(matching) : matching;
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
    // The CLI's connection syncer publishes `.zitadel/idps/*.json` here. The
    // Go service does not exist yet (#1003), so without these the SSO journey
    // cannot be exercised end to end at all.

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
        ? { ...existing, revisionId: `idprev_${shortId()}`, updatedAt: now, seq: ++store.lastSeq, body: definition }
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
          const order =
            field === "slug" ? a.slug.localeCompare(b.slug) : a.seq - b.seq;
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

    // --- releases ------------------------------------------------------------
    // What `zitadel deploy` builds from `.zitadel/` before it deploys.

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
      const pointers = body.data.pointers.map((p) => ({
        kind: p.kind,
        handle: pointerHandle(p.kind, p.revision_id),
        revision_id: p.revision_id,
      }));
      const seen = new Set<string>();
      for (const pointer of pointers) {
        const key = `${pointer.kind}/${pointer.handle}`;
        if (seen.has(key)) {
          return HttpResponse.json(
            errorBody("rel.invalid", `a release pins one revision of ${pointer.handle}, not two`),
            { status: 400 },
          );
        }
        seen.add(key);
      }
      const hash = contentHash(pointers);
      const existing = [...store.releases.values()].find(
        (r) => r.projectId === query.data.project_id && r.contentHash === hash,
      );
      if (existing) {
        const out = parse(CreateReleaseResponse, releaseResponse(existing), "mock_response_invalid");
        return out.ok ? HttpResponse.json(out.data, { status: 200 }) : out.response;
      }
      const release: ReleaseRecord = {
        id: `rel_${shortId()}`,
        projectId: query.data.project_id,
        contentHash: hash,
        pointers,
        message: body.data.message,
        gitSha: body.data.git_sha,
        gitDirty: body.data.git_dirty,
        createdAt: nowIso(),
        seq: ++store.lastSeq,
      };
      store.releases.set(release.id, release);
      const out = parse(CreateReleaseResponse, releaseResponse(release), "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data, { status: 201 }) : out.response;
    }),

    http.get("*/releases", ({ request }) => {
      const { limit, ...rest } = queryRecord(request);
      const query = parse(
        ListReleasesQueryParams,
        { ...rest, ...(limit === undefined ? {} : { limit: Number(limit) }) },
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }
      const releases = [...store.releases.values()]
        .filter((r) => r.projectId === query.data.project_id)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, query.data.limit)
        .map((r) => {
          const { pointers: _pointers, ...summary } = releaseResponse(r);
          return summary;
        });
      const out = parse(ListReleasesResponse, { releases, next_page_token: null }, "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
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
        return HttpResponse.json(errorBody("rel.not_found", "release not found"), { status: 404 });
      }
      const out = parse(GetReleaseByIdResponse, releaseResponse(release), "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
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
        return HttpResponse.json(errorBody("rel.not_found", "release not found"), { status: 404 });
      }
      release.revokedAt ??= nowIso();
      const out = parse(RevokeReleaseResponse, releaseResponse(release), "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
    }),

    // --- deployments ---------------------------------------------------------
    // Append-only. What a target serves is its newest row; a deploy writes
    // one row per target under one deploy id, and rolling back appends too.

    http.post("*/deployments/rollback", async ({ request }) => {
      const query = parse(RollbackDeploymentQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = (await readJson(request)) ?? {};
      const body = parse(RollbackDeploymentBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const projectId = query.data.project_id;
      if (!store.projects.has(projectId)) {
        return HttpResponse.json(errorBody("proj.not_found", "project not found"), { status: 404 });
      }
      const history = deploymentHistory(projectId);
      const undoneId = body.data.deploy_id ?? history[0]?.deployId;
      if (!undoneId) {
        return HttpResponse.json(errorBody("dep.not_found", "nothing has been deployed"), { status: 404 });
      }
      const undone = history
        .filter(
          (row) =>
            row.deployId === undoneId &&
            (body.data.origin === undefined || body.data.origin === null || row.origin === body.data.origin),
        )
        .sort((a, b) => a.seq - b.seq);
      if (undone.length === 0) {
        return HttpResponse.json(errorBody("dep.not_found", "deployment not found"), { status: 404 });
      }
      const deployId = `dpl_${shortId()}`;
      const warnings: string[] = [];
      const rows: DeploymentRecord[] = [];
      for (const row of undone) {
        // The release the target served before this deploy: the newest
        // earlier row naming a different release, values and all.
        const previous = history.find(
          (candidate) =>
            candidate.origin === row.origin && candidate.seq < row.seq && candidate.releaseId !== row.releaseId,
        );
        if (!previous) {
          warnings.push(`${row.origin || "(default)"} has no earlier release and was left as it is`);
          continue;
        }
        rows.push(
          appendDeployment({
            projectId,
            deployId,
            origin: row.origin,
            releaseId: previous.releaseId,
            reason: "rollback",
            message: body.data.message,
            rollbackOf: undoneId,
            variables: previous.variables,
          }),
        );
      }
      const out = parse(
        RollbackDeploymentResponse,
        deployResponse(deployId, rows[0]?.releaseId ?? undone[0]?.releaseId ?? "", rows, warnings),
        "mock_response_invalid",
      );
      return out.ok ? HttpResponse.json(out.data, { status: 201 }) : out.response;
    }),

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
        return HttpResponse.json(errorBody("proj.not_found", "project not found"), { status: 404 });
      }
      const resolved = resolveRelease(project.id, body.data.release);
      if (!resolved.ok) {
        return resolved.response;
      }
      const release = resolved.release;
      if (release.revokedAt) {
        return HttpResponse.json(errorBody("rel.revoked", "the release is revoked"), { status: 409 });
      }

      // Expansion: `default` is "", `primary` is every literal primary
      // pattern, and an exact origin has to be admitted by a pattern. Which
      // kind admitted it decides the verb: a preview run writes rows for
      // preview URLs only, and nothing else writes one.
      const targets: string[] = [];
      let preview = false;
      let production = false;
      for (const target of body.data.targets) {
        if (target === "default") {
          targets.push("");
          production = true;
          continue;
        }
        if (target === "primary") {
          for (const entry of project.allowedOrigins) {
            if (entry.kind === "primary" && !entry.pattern.includes("*")) {
              targets.push(entry.pattern);
            }
          }
          production = true;
          continue;
        }
        const matched = matchAllowedOrigin(project.allowedOrigins, target);
        if (!matched && !(project.class === "sandbox" && project.allowedOrigins.length === 0)) {
          return HttpResponse.json(
            errorBody("proj.origin_not_allowed", "the origin matches no allowed pattern", { origin: target }),
            { status: 403 },
          );
        }
        if (matched?.kind === "preview") {
          preview = true;
        } else {
          production = true;
        }
        targets.push(target);
      }
      if (preview && production) {
        return HttpResponse.json(
          errorBody("dep.invalid", "a preview deploy may not also move the default or a primary origin"),
          { status: 400 },
        );
      }
      if (preview && body.data.ttl_seconds === undefined) {
        return HttpResponse.json(errorBody("dep.invalid", "a preview target needs ttl_seconds"), { status: 400 });
      }
      if (!preview && body.data.ttl_seconds !== undefined) {
        return HttpResponse.json(
          errorBody("dep.invalid", "ttl_seconds only applies to preview targets"),
          { status: 400 },
        );
      }
      const unique = [...new Set(targets)];

      const expected = body.data.expected_deployment_id;
      if (expected) {
        const current = newestDeployment(project.id, unique[0] ?? "");
        if (current?.id !== expected) {
          return HttpResponse.json(
            errorBody("dep.conflict", "the target's newest deployment is not the expected one", {
              current_deployment_id: current?.id ?? "",
              current_release_id: current?.releaseId ?? "",
            }),
            { status: 409 },
          );
        }
      }

      const frozen = frozenVariables(project.id, preview);
      const current = unique.map((origin) => newestDeployment(project.id, origin));
      const unchanged = current.every(
        (row) => row !== undefined && row.releaseId === release.id && sameVariables(row.variables, frozen.values),
      );
      if (unchanged) {
        const rows = current as DeploymentRecord[];
        const out = parse(
          CreateDeploymentResponse,
          deployResponse(rows[0]?.deployId ?? "", release.id, rows, frozen.warnings),
          "mock_response_invalid",
        );
        return out.ok ? HttpResponse.json(out.data, { status: 200 }) : out.response;
      }

      const deployId = `dpl_${shortId()}`;
      const rows = unique.map((origin) =>
        appendDeployment({
          projectId: project.id,
          deployId,
          origin,
          releaseId: release.id,
          reason: body.data.reason ?? "deploy",
          message: body.data.message,
          variables: frozen.values,
        }),
      );
      if (preview) {
        const expiresAt = new Date(Date.now() + (body.data.ttl_seconds ?? 0) * 1000).toISOString();
        for (const origin of unique) {
          const key = originKey(project.id, origin);
          const createdAt = store.origins.get(key)?.createdAt ?? nowIso();
          store.origins.set(key, { projectId: project.id, origin, expiresAt, createdAt });
        }
      }
      const out = parse(
        CreateDeploymentResponse,
        deployResponse(deployId, release.id, rows, frozen.warnings),
        "mock_response_invalid",
      );
      return out.ok ? HttpResponse.json(out.data, { status: 201 }) : out.response;
    }),

    http.get("*/deployments", ({ request }) => {
      const { limit, live, expand, ...rest } = queryRecord(request);
      const query = parse(
        ListDeploymentsQueryParams,
        {
          ...rest,
          ...(limit === undefined ? {} : { limit: Number(limit) }),
          ...(live === undefined ? {} : { live: live === "true" }),
          ...(expand === undefined ? {} : { expand: expand.split(",") }),
        },
        "invalid_query",
      );
      if (!query.ok) {
        return query.response;
      }
      let rows = deploymentHistory(query.data.project_id);
      if (query.data.origin !== undefined) {
        rows = rows.filter((row) => row.origin === query.data.origin);
      }
      if (query.data.deploy_id !== undefined) {
        rows = rows.filter((row) => row.deployId === query.data.deploy_id);
      }
      if (query.data.live) {
        const seen = new Set<string>();
        rows = rows.filter((row) => {
          if (seen.has(row.origin)) {
            return false;
          }
          seen.add(row.origin);
          return true;
        });
      }
      const expandRelease = query.data.expand?.includes("release") ?? false;
      const start = query.data.page_token === undefined ? 0 : Number(query.data.page_token);
      if (!Number.isInteger(start) || start < 0) {
        return HttpResponse.json(errorBody("req.invalid", "invalid page token"), { status: 400 });
      }
      const page = rows.slice(start, start + query.data.limit);
      const next = start + query.data.limit < rows.length ? String(start + query.data.limit) : null;
      const out = parse(
        ListDeploymentsResponse,
        {
          deployments: page.map((row) => deploymentResponse(row, { live: query.data.live, expandRelease })),
          next_page_token: next,
        },
        "mock_response_invalid",
      );
      return out.ok ? HttpResponse.json(out.data) : out.response;
    }),

    http.get("*/deployments/:deployment_id/variables", ({ params, request }) => {
      const path = parse(GetDeploymentVariablesParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetDeploymentVariablesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const row = store.deployments.get(path.data.deployment_id);
      if (!row || row.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("dep.not_found", "deployment not found"), { status: 404 });
      }
      const out = parse(GetDeploymentVariablesResponse, variablesResponse(row.variables), "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
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
      const row = store.deployments.get(path.data.deployment_id);
      if (!row || row.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("dep.not_found", "deployment not found"), { status: 404 });
      }
      const out = parse(GetDeploymentByIdResponse, deploymentResponse(row), "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
    }),

    // --- live preview origins ----------------------------------------------

    http.get("*/origins", ({ request }) => {
      const query = parse(ListOriginsQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const now = Date.now();
      const origins = [...store.origins.values()]
        .filter((row) => row.projectId === query.data.project_id && new Date(row.expiresAt).getTime() > now)
        .map((row) => ({ origin: row.origin, expires_at: row.expiresAt, created_at: row.createdAt }));
      const out = parse(ListOriginsResponse, { origins }, "mock_response_invalid");
      return out.ok ? HttpResponse.json(out.data) : out.response;
    }),

    http.post("*/origins/remove", async ({ request }) => {
      const query = parse(RemoveOriginQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const raw = await readJson(request);
      if (raw === null) {
        return HttpResponse.json(INVALID_JSON, { status: 400 });
      }
      const body = parse(RemoveOriginBody, raw, "invalid_request");
      if (!body.ok) {
        return body.response;
      }
      const key = originKey(query.data.project_id, body.data.origin);
      if (!store.origins.has(key)) {
        return HttpResponse.json(errorBody("not_found", "resource not found"), { status: 404 });
      }
      store.origins.delete(key);
      return new HttpResponse(null, { status: 204 });
    }),
    // --- variables ---------------------------------------------------------
    // Where a connection's `${{ NAME }}` references resolve from. The CLI
    // publishes the client id and secret here, so without them a scaffolded
    // provider has no credentials and sign-in fails at the token endpoint.

    http.get("*/variables", ({ request }) => {
      const query = parse(GetVariablesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const owner = variableOwner(query.data.project_id, query.data.applies_to);
      const owned = store.variables.get(owner) ?? new Map<string, VariableRecord>();
      const out = parse(GetVariablesResponse, variablesResponse(owned), "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // One variable by name, which `vars get` and `vars rm` address directly.
    // A name with no value in the addressed bucket answers `var.not_found`
    // and leaves the other bucket's value standing.
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
      const owner = variableOwner(query.data.project_id, query.data.applies_to);
      const held = store.variables.get(owner)?.get(path.data.variable_name);
      if (held === undefined) {
        return HttpResponse.json(errorBody("var.not_found", "variable not found"), { status: 404 });
      }
      const body = held.secret ? { secret: true } : held.value;
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
      const owner = variableOwner(query.data.project_id, query.data.applies_to);
      const owned = store.variables.get(owner);
      const name = path.data.variable_name;
      if (owned?.has(name) !== true) {
        return HttpResponse.json(errorBody("var.not_found", "variable not found"), { status: 404 });
      }
      owned.delete(name);
      store.variables.set(owner, owned);
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

      const owner = variableOwner(query.data.project_id, query.data.applies_to);
      const owned = store.variables.get(owner) ?? new Map<string, VariableRecord>();
      // RFC 7386: a name present is written, `null` removes it, and a name
      // absent is left alone.
      for (const [name, value] of Object.entries(body.data as Record<string, unknown>)) {
        if (value === null) {
          owned.delete(name);
        } else if (typeof value === "object") {
          const input = value as { value: string | number | boolean; secret: boolean };
          owned.set(name, { value: input.value, secret: input.secret });
        } else {
          owned.set(name, { value: value as string | number | boolean, secret: false });
        }
      }
      store.variables.set(owner, owned);
      // 200 with the addressed bucket read back, so the response also carries
      // what it held and this write did not touch.
      const out = parse(UpdateVariablesResponse, variablesResponse(owned), "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

  ];
}
