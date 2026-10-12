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
  AddOrigin201,
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
  AddOriginBody,
  AddOriginParams,
  AddOriginResponse,
  CompleteClaimResponse,
  CreateFlowDefinitionBody,
  CreateIdpBody,
  CreateIdpQueryParams,
  CreateIdpResponse,
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
  ListReleasesQueryParams,
  ListSchemasQueryParams,
  QueryIdpsBody,
  QueryIdpsQueryParams,
  QueryIdpsResponse,
  QueryUsersBody,
  RemoveOriginBody,
  RemoveOriginParams,
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
  projectSecret: string;
  previewSecret: string;
  previewOrigins: string[];
  origins: OriginEntry[];
  createdAt: string;
  updatedAt: string;
};

/**
 * One of a project's origins (#1582): a normalised pattern and what it is for.
 * Stored one row per `(project, pattern)`; the project response reads them back
 * as `origins`.
 */
type OriginEntry = { pattern: string; kind: "primary" | "preview" };

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
  /**
   * The project's variables as this deployment resolved them, frozen when it was
   * written. A preview deployment prefers each name's `preview` override and
   * falls back to its `all` value; a primary deployment runs only the `all`
   * values. What the target serves, not what the store holds now.
   */
  frozenVariables: Map<string, VariableRecord>;
};

type Store = {
  projects: Map<string, ProjectRecord>;
  schemas: Map<string, SchemaRecord>;
  flowDefinitions: Map<string, FlowDefinitionRecord>;
  idps: Map<string, IdpConnectionRecord>;
  releases: Map<string, ReleaseRecord>;
  deployments: Map<string, DeploymentRecord>;
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
      ...(r.body as Record<string, unknown>),
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
function immutableFieldClash(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string | undefined {
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

/** Which value of a variable a request addresses. */
type AppliesTo = "all" | "preview";

/**
 * The owner a variables request addresses. An absent environment is the project
 * level, which is a different owner from any environment under it.
 *
 * `applies_to` is a further dimension of the same key, not a merge: the `all`
 * value a deploy freezes and the `preview` override a preview deploy prefers
 * live in separate buckets, so a `preview` read returns only the names that
 * hold a preview override and a `preview` write never touches the `all` value.
 */
function variableOwner(
  projectId: string,
  environmentName?: string,
  appliesTo: AppliesTo = "all",
): string {
  const base =
    environmentName === undefined ? `project:${projectId}` : `env:${projectId}/${environmentName}`;
  return `${base}#${appliesTo}`;
}

/**
 * A non-fatal condition a deployment reports back in its response. The only one
 * today: a preview deployment that froze an `all` secret because the name has
 * no preview override, so the preview URL serves the production credential —
 * allowed, but worth flagging (ADR 062 §7, #1617).
 */
type DeploymentWarning = { code: string; message: string; variable: string };

/**
 * The project's variables as a deployment freezes them, and any warnings the
 * freeze raised. A primary deployment runs the `all` values alone; a preview
 * deployment prefers each name's `preview` override and falls back to the `all`
 * value where none exists. The result is a flat map — one value per name — so a
 * deployment never has to choose at read time.
 *
 * A preview fallback to an `all` secret is flagged: there is no preview-only
 * override, so the preview URL would serve the production secret, which the
 * operator should know even though it is not refused.
 */
function freezeVariables(
  projectId: string,
  preview: boolean,
): { frozen: Map<string, VariableRecord>; warnings: DeploymentWarning[] } {
  const all =
    store.variables.get(variableOwner(projectId, undefined, "all")) ??
    new Map<string, VariableRecord>();
  if (!preview) {
    return { frozen: new Map(all), warnings: [] };
  }
  const overrides =
    store.variables.get(variableOwner(projectId, undefined, "preview")) ??
    new Map<string, VariableRecord>();
  const frozen = new Map(all);
  for (const [name, held] of overrides) {
    frozen.set(name, held);
  }
  const warnings: DeploymentWarning[] = [];
  for (const [name, held] of all) {
    if (held.secret && !overrides.has(name)) {
      warnings.push({
        code: "variable.missing_preview_secret",
        message: `preview deployment falls back to the all secret ${name}; set a preview override to avoid serving the production secret`,
        variable: name,
      });
    }
  }
  // Sorted by name so the warning list is stable between runs, like the rest of
  // the mock's collection output.
  warnings.sort((a, b) => a.variable.localeCompare(b.variable));
  return { frozen, warnings };
}

/**
 * Whether two frozen variable snapshots are identical — same names, each with
 * the same value and secret flag. A deployment is idempotent only when the
 * release and this snapshot both match, so a variable-only change still writes
 * a new deployment even when the release content is unchanged.
 */
function sameVariableSnapshot(
  a: Map<string, VariableRecord>,
  b: Map<string, VariableRecord>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [name, held] of a) {
    const other = b.get(name);
    if (other === undefined || other.secret !== held.secret || other.value !== held.value) {
      return false;
    }
  }
  return true;
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
   * The origin patterns stored across every project, in insertion order. A
   * caller driving the mock over HTTP observes origins through `GET
   * /projects/:id` (the CLI's `origin list`); this is the in-process view.
   */
  originPatterns: string[];
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
    releaseIds: [...store.releases.values()]
      .sort((a, b) => b.seq - a.seq)
      .map((release) => release.id),
    releaseContentHashes: [...store.releases.values()].map(
      (release) => `${RELEASE_CONTENT_HASH_PREFIX}${release.contentHash}`,
    ),
    deploymentIds: [...store.deployments.values()]
      .sort((a, b) => b.seq - a.seq)
      .map((deployment) => deployment.id),
    variableNames: [
      ...new Set([...store.variables.values()].flatMap((owned) => [...owned.keys()])),
    ],
    originPatterns: [...store.projects.values()].flatMap((project) =>
      project.origins.map((origin) => origin.pattern),
    ),
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
 * schema-dependent subset runs only when the pinned `user_schema` resolves
 * in the mock store — the real server would fail such a flow with
 * `schema_fetch_failed`, but fixtures here may pin external URLs.
 * Returns null when the definition is valid.
 */
function invalidFlowDefinitionResponse(flowDefinition: Record<string, unknown>): Response | null {
  const ref = flowDefinition.user_schema;
  const schema = typeof ref === "string" ? store.schemas.get(ref)?.body : undefined;
  const firstError = validateFlowDefinition(flowDefinition, schema as object | undefined).find(
    (issue) => issue.severity === "error",
  );
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

// --- origins -----------------------------------------------------------
// Origin patterns are project state (#1582). The Go handler is an
// unimplemented stub for now, so this mock is where the add-time rules live:
// a `primary` pattern is an exact URL, a `preview` pattern may carry a `*`
// (one or more characters, none a dot), and a `*` on a shared host needs a
// literal label the tenant owns. A host the server has no rule for is stored
// as written. Kept in one block so parallel PRs do not collide.

/** A host anyone can mint names under, and the shape a tenant-unique label takes there. */
const SHARED_ORIGIN_HOSTS: readonly { suffix: string; bounded: (left: string) => boolean }[] = [
  // <project>-git-<branch>-<team>.vercel.app: the team slug ends the label.
  { suffix: ".vercel.app", bounded: (left) => /^\*-[^*]+$/.test(left) },
  // deploy-preview-<n>--<site>.netlify.app: the site name ends the label.
  { suffix: ".netlify.app", bounded: (left) => /^\*--[^*]+$/.test(left) },
  // <hash>.<project>.pages.dev: the project is its own dotted label.
  { suffix: ".pages.dev", bounded: dottedOriginLabel },
  // <version>-<worker>.<account>.workers.dev: the account is its own dotted label.
  { suffix: ".workers.dev", bounded: dottedOriginLabel },
];

/** Accepts `*.<label>` where the label carries no wildcard of its own. */
function dottedOriginLabel(left: string): boolean {
  const rest = left.startsWith("*.") ? left.slice(2) : undefined;
  return rest !== undefined && rest.length > 0 && !rest.includes("*");
}

/**
 * Lowercase and validate an origin or an origin pattern: `scheme://host[:port]`
 * with no path, query, fragment or credentials. A `*` is accepted anywhere in
 * the host, which is what makes this usable for patterns too. Returns the
 * normalised form, or null when it is malformed.
 */
function normalizeOrigin(raw: string): string | null {
  const origin = raw.trim().toLowerCase();
  const sep = origin.indexOf("://");
  if (sep < 0) {
    return null;
  }
  const scheme = origin.slice(0, sep);
  const host = origin.slice(sep + 3);
  if ((scheme !== "http" && scheme !== "https") || host === "" || /[/?#@ \t]/.test(host)) {
    return null;
  }
  const hostname = host.replace(/:\d+$/, "");
  if (
    hostname === "" ||
    hostname.startsWith(".") ||
    hostname.endsWith(".") ||
    hostname.includes("..")
  ) {
    return null;
  }
  return origin;
}

/**
 * Whether a wildcard pattern sits on a shared host the server knows with no
 * tenant-unique label beside the wildcard. A host with no rule returns false:
 * it is stored as written.
 */
function originUnbounded(pattern: string): boolean {
  const host = pattern.slice(pattern.indexOf("://") + 3).replace(/:\d+$/, "");
  for (const shared of SHARED_ORIGIN_HOSTS) {
    if (host.endsWith(shared.suffix)) {
      return !shared.bounded(host.slice(0, host.length - shared.suffix.length));
    }
  }
  return false;
}

/**
 * The project the write addresses, once the bearer is checked. Add and remove
 * carry no session fallback (#1582): the project secret is the only credential
 * that widens or narrows the list, so a preview-deploy token is refused with
 * `proj.permission_denied` and an unknown token with `auth.unauthorized`.
 */
function authorizeProjectWrite(
  request: Request,
  projectId: string,
): { ok: true; project: ProjectRecord } | { ok: false; response: HttpResponse<ErrorBody> } {
  const project = store.projects.get(projectId);
  if (!project) {
    return {
      ok: false,
      response: HttpResponse.json(errorBody("proj.not_found", "project not found"), {
        status: 404,
      }),
    };
  }
  const token = bearerToken(request);
  if (token === project.projectSecret) {
    return { ok: true, project };
  }
  if (token === project.previewSecret) {
    return {
      ok: false,
      response: HttpResponse.json(
        errorBody(
          "proj.permission_denied",
          "the project management API requires the project secret",
        ),
        { status: 403 },
      ),
    };
  }
  return {
    ok: false,
    response: HttpResponse.json(errorBody("auth.unauthorized", "missing or invalid credentials"), {
      status: 401,
    }),
  };
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
function materializeBundle(projectId: string, bundle: Record<string, unknown>): ReleasePointer[] {
  const pointers: ReleasePointer[] = [];
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
  for (const item of asArray(bundle.brandings)) {
    const resource = isObject(item) ? item : {};
    pointers.push({
      kind: "branding",
      handle: bundleResourceHandle("branding", resource),
      revision_id: `branding_${shortId()}`,
    });
  }
  return pointers;
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
    ["brandings", "branding"],
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

/** Turn a `ttl` (`30m`, `168h`, `7d`) into an ISO expiry counted from now. */
function ttlToExpiry(ttl: string): string {
  const match = /^([1-9][0-9]*)([mhd])$/.exec(ttl);
  if (!match) {
    return new Date().toISOString();
  }
  const amount = Number(match[1]);
  const unitMs = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + amount * unitMs).toISOString();
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

/** The newest deployment to an origin, treating an expired preview as gone. */
function newestDeploymentForOrigin(
  projectId: string,
  origin: string,
): DeploymentRecord | undefined {
  const now = Date.now();
  return [...store.deployments.values()]
    .filter((deployment) => deployment.projectId === projectId)
    .filter((deployment) =>
      deployment.targets.some(
        (target) =>
          target.origin === origin &&
          (target.expiresAt === null || new Date(target.expiresAt).getTime() > now),
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
        previewOrigins: body.data.preview_origins ?? [],
        origins: [],
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
        preview_origins: project.previewOrigins,
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
      };
      const out = parse(GetProjectResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // --- origins ---------------------------------------------------------
    // Add one `{pattern, kind}` to the project, or remove one by its pattern.
    // The validation here stands in for the server rule (#1582); the Go
    // handler is an unimplemented stub.

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
      const auth = authorizeProjectWrite(request, path.data.project_id);
      if (!auth.ok) {
        return auth.response;
      }

      const normalized = normalizeOrigin(body.data.pattern);
      if (normalized === null) {
        return HttpResponse.json(
          errorBody("origin.invalid", "origin: must be scheme://host[:port] with no path"),
          { status: 400 },
        );
      }
      const hasStar = normalized.includes("*");
      if (body.data.kind === "primary" && hasStar) {
        return HttpResponse.json(
          errorBody("origin.primary_not_exact", "a primary origin is an exact URL, no wildcard"),
          { status: 400 },
        );
      }
      if (hasStar && originUnbounded(normalized)) {
        return HttpResponse.json(
          errorBody(
            "origin.unbounded",
            "origin: a wildcard on a shared host needs a literal label of your own beside the host",
          ),
          { status: 400 },
        );
      }

      // The contract stores an otherwise-valid pattern as written, so the
      // stored and echoed value keeps the submitted casing: validation and the
      // shared-host checks above fold case through `normalized`, but that lower-
      // cased form is never what gets stored.
      const pattern = body.data.pattern.trim();
      // One row per `(project, pattern)`: a repeat of the same pattern replaces
      // its kind rather than storing a second row. Dedup folds case too, since a
      // host that differs only in case is the same origin.
      auth.project.origins = auth.project.origins.filter(
        (origin) => normalizeOrigin(origin.pattern) !== normalized,
      );
      auth.project.origins.push({ pattern, kind: body.data.kind });

      const responseBody: AddOrigin201 = { pattern, kind: body.data.kind };
      const out = parse(AddOriginResponse, responseBody, "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data, { status: 201 });
    }),

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
      const auth = authorizeProjectWrite(request, path.data.project_id);
      if (!auth.ok) {
        return auth.response;
      }

      // A malformed pattern cannot match a stored one, so it falls through to
      // the not-found answer rather than being rejected.
      const normalized =
        normalizeOrigin(body.data.pattern) ?? body.data.pattern.trim().toLowerCase();
      const before = auth.project.origins.length;
      // Stored patterns keep their submitted casing, so match case-insensitively
      // through `normalizeOrigin` (mirroring the add-path dedup); otherwise a
      // mixed-case `https://App.Acme.com` could never be removed.
      auth.project.origins = auth.project.origins.filter(
        (origin) =>
          (normalizeOrigin(origin.pattern) ?? origin.pattern.trim().toLowerCase()) !== normalized,
      );
      if (auth.project.origins.length === before) {
        return HttpResponse.json(
          errorBody("origin.not_found", "origin: no such pattern on this project"),
          { status: 404 },
        );
      }
      return new HttpResponse(null, { status: 204 });
    }),

    // --- releases --------------------------------------------------------
    // A release is assembled from a bundle (the CLI's form) or from pointers.
    // The content digest dedupes a re-submission; revoke blocks it from ever
    // being served again. The Go handlers are unimplemented stubs.

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
      // `makePointers` is deferred so a bundle only materialises revisions when
      // the release is new, not on a deduped resubmission.
      let digest: string;
      let makePointers: () => ReleasePointer[];
      if (isObject(data.bundle)) {
        const bundle = data.bundle;
        const entries = bundleDigestEntries(bundle);
        if (entries.length === 0 || entries.length > 50) {
          return HttpResponse.json(
            errorBody("rel.invalid", "release: a bundle carries between 1 and 50 resources"),
            { status: 400 },
          );
        }
        digest = contentDigest(entries);
        makePointers = () => materializeBundle(project.id, bundle);
      } else if (Array.isArray(data.pointers)) {
        const pointers = data.pointers.map((item) => {
          const pointer = item as { kind: string; revision_id: string };
          return {
            kind: pointer.kind,
            handle: pointerHandle(pointer.kind, pointer.revision_id),
            revision_id: pointer.revision_id,
          };
        });
        digest = contentDigest(
          pointers.map((pointer) => ({
            kind: pointer.kind,
            handle: pointer.handle,
            content: pointer.revision_id,
          })),
        );
        makePointers = () => pointers;
      } else {
        return HttpResponse.json(
          errorBody("rel.invalid", "release: send exactly one of pointers or bundle"),
          { status: 400 },
        );
      }

      const existing = [...store.releases.values()].find(
        (release) => release.projectId === project.id && release.contentHash === digest,
      );
      if (existing) {
        return HttpResponse.json(releaseResponse(existing), { status: 200 });
      }

      const pointers = makePointers();
      const id = `rel_${shortId()}`;
      const record: ReleaseRecord = {
        id,
        projectId: project.id,
        contentHash: digest,
        pointers,
        message: typeof data.message === "string" ? data.message : null,
        gitSha: typeof data.git_sha === "string" ? data.git_sha : null,
        gitDirty: data.git_dirty === true,
        createdAt: nowIso(),
        revokedAt: null,
        seq: ++store.lastSeq,
      };
      store.releases.set(id, record);
      return HttpResponse.json(releaseResponse(record), { status: 201 });
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
            (candidate) =>
              `${RELEASE_CONTENT_HASH_PREFIX}${candidate.contentHash}` === data.content_hash,
          );
      if (!release || release.projectId !== project.id) {
        return HttpResponse.json(errorBody("rel.not_found", "release: not found"), { status: 404 });
      }
      if (release.revokedAt !== null) {
        return HttpResponse.json(errorBody("rel.revoked", "release: revoked"), { status: 409 });
      }

      const requested = data.targets as string[];
      const primaries = primaryOrigins(project);
      const resolved = new Set<string>();
      let sawPreview = false;
      let sawPrimary = false;
      for (const target of requested) {
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
          resolved.add(target);
          sawPrimary = true;
          continue;
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
      if (sawPreview && sawPrimary) {
        return HttpResponse.json(
          errorBody("dep.invalid", "deployment: primary origins and preview URLs cannot be mixed"),
          { status: 400 },
        );
      }
      const ttl = typeof data.ttl === "string" ? data.ttl : undefined;
      if (ttl !== undefined && !sawPreview) {
        return HttpResponse.json(
          errorBody("dep.invalid", "deployment: ttl is only valid for preview URLs"),
          { status: 400 },
        );
      }

      const targets = [...resolved].sort();
      const expectedId =
        typeof data.expected_deployment_id === "string" ? data.expected_deployment_id : undefined;
      if (expectedId !== undefined) {
        for (const origin of targets) {
          const newest = newestDeploymentForOrigin(project.id, origin);
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
      }

      // The snapshot this deployment would freeze, resolved now. It decides
      // idempotency alongside the release: a variable-only change leaves the
      // release untouched but must still create a new deployment.
      const { frozen, warnings } = freezeVariables(project.id, sawPreview);

      // Idempotent on what is served: a new deployment is skipped only when
      // every target already runs this release *and* the same frozen variable
      // snapshot. A later variable write changes the snapshot, so the same
      // release deploys afresh rather than being deduped away.
      const alreadyServed = targets.every((origin) => {
        const newest = newestDeploymentForOrigin(project.id, origin);
        return (
          newest !== undefined &&
          newest.releaseId === release.id &&
          sameVariableSnapshot(newest.frozenVariables, frozen)
        );
      });
      if (targets.length > 0 && alreadyServed) {
        const newest = [...store.deployments.values()]
          .filter(
            (deployment) =>
              deployment.projectId === project.id &&
              deployment.releaseId === release.id &&
              sameVariableSnapshot(deployment.frozenVariables, frozen) &&
              deployment.targets.some((target) => targets.includes(target.origin)),
          )
          .sort((a, b) => b.seq - a.seq)[0];
        if (newest) {
          // The create-deployment response wraps the deployment with the
          // non-blocking `warnings` it raised. Re-deploying an unchanged preview
          // that still falls back to an `all` secret keeps raising
          // `variable.missing_preview_secret`, so the idempotent 200 carries the
          // renewed warnings rather than dropping them — the preview consumer
          // surfaces the safety warning on every retry, not only the first.
          const base = deploymentResponse(newest);
          return HttpResponse.json(warnings.length > 0 ? { ...base, warnings } : base, {
            status: 200,
          });
        }
      }

      const expiresAt = sawPreview && ttl ? ttlToExpiry(ttl) : null;
      const id = `dep_${shortId()}`;
      const record: DeploymentRecord = {
        id,
        projectId: project.id,
        releaseId: release.id,
        targets: targets.map((origin) => ({ origin, expiresAt: sawPreview ? expiresAt : null })),
        reason: data.reason === "rollback" ? "rollback" : "deploy",
        message: typeof data.message === "string" ? data.message : null,
        rollbackTo: null,
        deployedAt: nowIso(),
        seq: ++store.lastSeq,
        // Frozen now: a later variable write never reaches a deployment already
        // made. A preview deployment prefers the preview overrides.
        frozenVariables: frozen,
      };
      store.deployments.set(id, record);
      // Warnings ride the create response (a preview falling back to an `all`
      // secret), surfaced only when there are any so the common case stays the
      // bare deployment shape.
      const response = deploymentResponse(record);
      return HttpResponse.json(warnings.length > 0 ? { ...response, warnings } : response, {
        status: 201,
      });
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
        const now = Date.now();
        const liveOrigins = new Set(
          deployments.flatMap((deployment) => deployment.targets.map((target) => target.origin)),
        );
        for (const target of liveOrigins) {
          if (origin !== undefined && target !== origin) {
            continue;
          }
          const newest = newestDeploymentForOrigin(query.data.project_id, target);
          if (!newest) {
            continue;
          }
          const row = newest.targets.find(
            (candidate) =>
              candidate.origin === target &&
              (candidate.expiresAt === null || new Date(candidate.expiresAt).getTime() > now),
          );
          if (!row) {
            continue;
          }
          const rows = serving.get(newest.id) ?? [];
          rows.push(row);
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

    // The variables a deployment runs: the map frozen onto it when it was
    // written, which `variable resolve` reads. What the target serves, not what
    // the store holds now.
    http.get("*/deployments/:deployment_id/variables", ({ params, request }) => {
      const path = parse(GetDeploymentVariablesParams, params, "invalid_request");
      if (!path.ok) {
        return path.response;
      }
      const query = parse(GetDeploymentVariablesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const deployment = store.deployments.get(path.data.deployment_id);
      if (!deployment || deployment.projectId !== query.data.project_id) {
        return HttpResponse.json(errorBody("dep.not_found", "deployment: not found"), {
          status: 404,
        });
      }
      const out = parse(
        GetDeploymentVariablesResponse,
        variablesResponse(deployment.frozenVariables),
        "mock_response_invalid",
      );
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
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
      // target must still be a primary origin of the project.
      if (target.targets.some((row) => row.expiresAt !== null)) {
        return HttpResponse.json(
          errorBody(
            "dep.invalid",
            "deployment: a deployment to preview URLs cannot be rolled back",
          ),
          { status: 409 },
        );
      }
      const primaries = primaryOrigins(project);
      const removed = target.targets.find((row) => !primaries.includes(row.origin));
      if (removed) {
        return HttpResponse.json(
          errorBody(
            "dep.invalid",
            `deployment: ${removed.origin} is no longer a primary origin of the project`,
          ),
          { status: 409 },
        );
      }
      const release = store.releases.get(target.releaseId);
      if (release?.revokedAt) {
        return HttpResponse.json(errorBody("rel.revoked", "release: revoked"), { status: 409 });
      }

      const origins = target.targets.map((row) => row.origin);
      // A rollback re-applies the deployment being reverted to, so what it
      // restores is that deployment's own frozen snapshot — not the project's
      // current `all` bucket, which may have drifted since. Idempotent only
      // when the newest already serves both this release and that snapshot.
      const alreadyServed = origins.every((origin) => {
        const newest = newestDeploymentForOrigin(project.id, origin);
        return (
          newest !== undefined &&
          newest.releaseId === target.releaseId &&
          sameVariableSnapshot(newest.frozenVariables, target.frozenVariables)
        );
      });
      if (alreadyServed) {
        const newest = [...store.deployments.values()]
          .filter(
            (deployment) =>
              deployment.projectId === project.id &&
              deployment.releaseId === target.releaseId &&
              sameVariableSnapshot(deployment.frozenVariables, target.frozenVariables) &&
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
        // Restores the snapshot the reverted deployment froze: a rollback reruns
        // what that deployment served, variables included, so it copies that
        // frozen map rather than re-reading the store it may no longer match.
        frozenVariables: new Map(target.frozenVariables),
      };
      store.deployments.set(id, record);
      return HttpResponse.json(deploymentResponse(record), { status: 201 });
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

    // --- variables ---------------------------------------------------------
    // Where a connection's `${{ NAME }}` references resolve from. The CLI
    // publishes the client id and secret here, so without them a scaffolded
    // provider has no credentials and sign-in fails at the token endpoint.

    http.get("*/variables", ({ request }) => {
      const query = parse(GetVariablesQueryParams, queryRecord(request), "invalid_query");
      if (!query.ok) {
        return query.response;
      }
      const owner = variableOwner(
        query.data.project_id,
        query.data.environment_name,
        query.data.applies_to,
      );
      const owned = store.variables.get(owner) ?? new Map<string, VariableRecord>();
      const out = parse(GetVariablesResponse, variablesResponse(owned), "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),

    // One variable by name, which `variables get` and `variables delete`
    // address directly. A variable belongs to the owner that entered it, so a
    // name another owner of the same project holds answers `var.not_found`
    // and leaves that owner's value standing.
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
      const owner = variableOwner(
        query.data.project_id,
        query.data.environment_name,
        query.data.applies_to,
      );
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
      const owner = variableOwner(
        query.data.project_id,
        query.data.environment_name,
        query.data.applies_to,
      );
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

      const owner = variableOwner(
        query.data.project_id,
        query.data.environment_name,
        query.data.applies_to,
      );
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
      // 200 with the addressed owner read back, so the response also carries
      // what that owner held and this write did not touch.
      const out = parse(UpdateVariablesResponse, variablesResponse(owned), "mock_response_invalid");
      if (!out.ok) {
        return out.response;
      }
      return HttpResponse.json(out.data);
    }),
  ];
}
