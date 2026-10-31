import type { GetReleaseById200 } from "@zitadel/api/generated/model";
import {
  CreateGrantBody,
  CreateTeamBody,
  CreateUserBody,
  PatchProjectBody,
  PatchUserByIDBody,
  QueryGrantsBody,
  QueryProjectsBody,
  QuerySessionsBody,
  QueryTeamsBody,
  QueryUsersBody,
  UpdateTeamBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import {
  GetBrandingByIdResponse,
  GetFlowDefinitionResponse,
  CreateIdpBody,
  GetGrantResponse,
  GetProjectResponse,
  GetSessionResponse,
  GetReleaseByIdResponse,
  GetSchemaByIdResponse,
  GetIdpByIdResponse,
  GetPolicyResponse,
  GetTeamResponse,
  GetUserByIDResponse,
  ListBrandingResponse,
  ListEventsResponse,
  ListFlowDefinitionsResponse,
  ListPoliciesResponse,
  ListReleasesResponse,
  PublishPolicyBody,
  ListSchemasResponse,
  QueryGrantsResponse,
  QueryIdpsBody,
  QueryIdpsResponse,
  QueryProjectsResponse,
  QuerySessionsResponse,
  QueryTeamsResponse,
  QueryUsersResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { isVariableReference } from "@zitadel/config/idp";

import type { ZitadelClient } from "../lib/api-client";
import { CommandGroups } from "../lib/oclif/groups";
import { ZitadelError } from "../lib/errors";
import {
  buildResourceCommands,
  type CreateSpec,
  type FieldPath,
  type GetSpec,
  type Json,
  type ListSpec,
  renderTable,
  type ResourceDescriptor,
  type ResourceRegistry,
  type Schema,
  type UpdateSpec,
  type WriteResult,
  type WriteShape,
} from "../lib/oclif/crud";

/**
 * The platform connection every resource verb calls through: the typed
 * client bound to the resolved server, plus the project the credential
 * belongs to. Endpoints that scope by `project_id` read it
 * from here; the flag surface never exposes it.
 */
export type Platform = Readonly<{ client: ZitadelClient; projectId: string }>;

// Builders that infer a verb's body type from its Zod schema, so `call` gets
// the typed body straight from `parseOrThrow` — no cast from `Json`.
export const create = <B, C>(
  schema: Schema<B>,
  call: (ctx: Platform, body: B) => Promise<C>,
  shape: WriteShape = {},
): NoInfer<CreateSpec<Platform, B, C>> => ({ ...shape, schema, call });

export const update = <B, U>(
  schema: Schema<B>,
  call: (ctx: Platform, id: string, body: B) => Promise<U>,
  shape: WriteShape = {},
): NoInfer<UpdateSpec<Platform, B, U>> => ({ ...shape, schema, call });

// Marks a descriptor `resource()` checked; `RESOURCES` takes no other, so an
// entry written as a plain object cannot skip the checks.
const checked = Symbol("checked");
type Checked = ResourceDescriptor<Platform> & { readonly [checked]: true };

/** A registry of descriptors `resource()` checked: the type `RESOURCES` satisfies. */
export type CheckedRegistry = ResourceRegistry<Platform> & Readonly<Record<string, Checked>>;

// The fields of `T`, each of any type: what a response schema must parse into
// at least. A schema copied from another operation names other fields. The
// types below them may differ: a schema applies the spec's defaults, and types
// a recursive field as `unknown` where the generated type spells it out.
type FieldsOf<T> = { [K in keyof T]: unknown };

// What a write must answer with: a record carrying the resource's id under
// `Id`, or the empty answer `WriteResult` allows (`grants create` by
// identifier answers 202).
type Written<Id extends string> = Readonly<Record<Id, unknown>> | Exclude<WriteResult, Json>;

// Infers a list's page `P` from `call` and its item `T` from `items`, which
// reads the list off that page, and checks `item` against `T`. Infers a
// structured query's request type `B` from its `body` schema; a `GET` list has
// no body, so its request stays `Json`. `items` comes after `call`, so the page
// is known when `items` is read.
export const list = <B = Json, P = unknown, T = unknown, S extends FieldsOf<T> = FieldsOf<T>>(
  spec: ListSpec<Platform, B, P, T> & { item?: Schema<S> },
): NoInfer<ListSpec<Platform, B, P, T>> => spec;

// Infers the record `get` answers with, so `sections` reads it typed.
export const get = <R, S extends FieldsOf<R> = FieldsOf<R>>(
  spec: GetSpec<Platform, R> & { response?: Schema<S> },
): NoInfer<GetSpec<Platform, R>> => spec;

// Checks a resource's paths against what its verbs answer with: `columns` name
// fields of a listed item, `heading` and `detail` fields of the record `get`
// answers with, and `idField` a field of both that `create` and `update`
// answer with. It builds `idOf` from `idField`, the typed read a write's
// suggested `get` takes its id from.
export const resource = <
  P,
  T,
  R,
  B extends Json,
  CB extends Json,
  UB extends Json,
  Id extends keyof T & keyof R & string,
>(
  descriptor: Omit<
    ResourceDescriptor<Platform>,
    "list" | "get" | "create" | "update" | "idField" | "idOf" | "columns" | "heading" | "detail"
  > & {
    list: ListSpec<Platform, B, P, T>;
    get: GetSpec<Platform, R>;
    create?: CreateSpec<Platform, CB, Written<NoInfer<Id>>>;
    update?: UpdateSpec<Platform, UB, Written<NoInfer<Id>>>;
    idField: Id;
    columns: readonly NoInfer<FieldPath<T>>[];
    heading: NoInfer<FieldPath<R>>;
    detail: readonly NoInfer<FieldPath<R>>[];
  },
): Checked & { readonly get: GetSpec<Platform, R> } => ({
  ...descriptor,
  idOf: (written: Readonly<Record<Id, unknown>>) => written[descriptor.idField],
  [checked]: true,
});

/** Filter operations of `POST /<resource>/query` endpoints (ADR 031). */
const FILTER_OPERATIONS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "less_than",
  "less_than_or_equal",
  "greater_than",
  "greater_than_or_equal",
] as const;

const EVENT_CATEGORIES = ["request", "auth", "session", "admin", "entity", "signal"] as const;

/** A release's pointers as an indented table, one pinned revision per row. */
export const releasePointers = (release: Pick<GetReleaseById200, "pointers">): string => {
  const { pointers } = release;
  const table = renderTable(["kind", "handle", "revision_id"], pointers)
    .split("\n")
    .map((line) => `  ${line}`);
  return ["resources", ...table].join("\n");
};

/** The operations a policy can guard, as the generated publish body names them. */
const POLICY_OPERATIONS = PublishPolicyBody.shape.operation.options;

/**
 * The runtime resources the CLI manages imperatively — one entry per topic.
 * Config resources (schemas, flows, branding, releases) are deliberately
 * absent: they are published from `.zitadel/**` through `deploy`
 * (ADR 007, ADR 035), and an imperative write path would fork that source of
 * truth. Adding a backend resource is adding an entry here.
 */
export const RESOURCES = {
  users: resource({
    group: CommandGroups.usersAndTeams,
    groupOrder: 1,
    singular: "user",
    idField: "id",
    // `identifier` is the user's login handle (their email under the default
    // schema); the schema URL it replaced is identical on every row.
    columns: ["id", "identifier", "metadata.status", "metadata.created_at"],
    heading: "identifier",
    detail: [
      "id",
      "identifier_property",
      "metadata.status",
      "schema",
      "metadata.lifecycle_owner_team_id",
      "metadata.created_at",
      "metadata.updated_at",
    ],
    list: list({
      body: QueryUsersBody,
      item: QueryUsersResponse.shape.users.element,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "id", operations: FILTER_OPERATIONS },
        { field: "schema", operations: FILTER_OPERATIONS },
        { field: "schema_object_type", operations: ["equals", "not_equals", "contains"] },
        { field: "status", operations: FILTER_OPERATIONS },
        { field: "team_id", operations: FILTER_OPERATIONS },
        { field: "lifecycle_owner_team_id", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "id", "schema", "status", "lifecycle_owner_team_id"],
      // No project_id: the users query defaults to the token's own project,
      // which is the only one a project secret can list.
      call: ({ client }, body) => client.queryUsers(body),
      items: (page) => page.users,
      next: (page) => page.next_page_token,
    }),
    get: get({ call: ({ client }, id) => client.getUserByID(id), response: GetUserByIDResponse }),
    create: create(CreateUserBody, ({ client, projectId }, body) =>
      client.createUser(body, { project_id: projectId }),
    ),
    update: update(PatchUserByIDBody, ({ client }, id, body) => client.patchUserByID(id, body)),
    delete: { call: ({ client }, id) => client.deleteUserByID(id) },
  }),

  teams: resource({
    group: CommandGroups.usersAndTeams,
    groupOrder: 2,
    singular: "team",
    idField: "id",
    columns: ["id", "name", "status", "created_at"],
    heading: "name",
    detail: ["id", "status", "created_at", "updated_at"],
    list: list({
      body: QueryTeamsBody,
      item: QueryTeamsResponse.shape.teams.element,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "name", operations: FILTER_OPERATIONS },
        { field: "status", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "name", "status"],
      call: ({ client, projectId }, body) => client.queryTeams(body, { project_id: projectId }),
      items: (page) => page.teams,
      next: (page) => page.next_page_token,
    }),
    get: get({ call: ({ client }, id) => client.getTeam(id), response: GetTeamResponse }),
    create: create(CreateTeamBody, ({ client, projectId }, body) =>
      client.createTeam(body, { project_id: projectId }),
    ),
    update: update(UpdateTeamBody, ({ client }, id, body) => client.updateTeam(id, body)),
    // A team's DELETE deactivates it and leaves it readable (ADR 024), so the
    // command is named after that rather than claiming the team is gone.
    delete: { verb: "deactivate", call: ({ client }, id) => client.deleteTeam(id) },
  }),

  sessions: resource({
    group: CommandGroups.authentication,
    singular: "session",
    idField: "session_id",
    columns: ["session_id", "state", "user_id", "created_at", "expires_at"],
    heading: "session_id",
    detail: ["project_id", "state", "user_id", "created_at", "expires_at"],
    list: list({
      body: QuerySessionsBody,
      item: QuerySessionsResponse.shape.sessions.element,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "user_id", operations: FILTER_OPERATIONS },
        { field: "state", operations: FILTER_OPERATIONS },
        { field: "lifecycle_owner_team_id", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "user_id"],
      call: ({ client, projectId }, body) => client.querySessions(body, { project_id: projectId }),
      items: (page) => page.sessions,
      next: (page) => page.next_page_token,
    }),
    get: get({ call: ({ client }, id) => client.getSession(id), response: GetSessionResponse }),
    // The endpoint terminates the session rather than removing a record, so
    // the command says `revoke`. `delete` would tell the caller it is gone.
    delete: { verb: "revoke", call: ({ client }, id) => client.revokeSession(id) },
  }),

  events: resource({
    group: CommandGroups.diagnostics,
    singular: "event",
    idField: "id",
    columns: ["id", "event_type", "category", "actor_id", "occurred_at"],
    heading: "event_type",
    detail: [
      "id",
      "category",
      "actor_id",
      "actor_type",
      "entity_type",
      "entity_id",
      "request_id",
      "occurred_at",
    ],
    list: list({
      item: ListEventsResponse.shape.data.element,
      // `GET /events` spells its filters as flat query parameters, and a range
      // as two of them. Declaring the parameter each operation travels as lets
      // the caller write the same `field=operation:value` they write for every
      // other resource, with no grammar invented that the endpoint cannot
      // honour.
      filters: [
        {
          field: "category",
          operations: ["equals"],
          values: EVENT_CATEGORIES,
          combine: "or",
        },
        { field: "event_type", operations: ["equals"], combine: "or" },
        { field: "actor_id", operations: ["equals"] },
        { field: "session_id", operations: ["equals"] },
        { field: "flow_id", operations: ["equals"] },
        { field: "request_id", operations: ["equals"] },
        { field: "entity_type", operations: ["equals"] },
        { field: "entity_id", operations: ["equals"] },
        { field: "team_id", operations: ["equals"] },
        {
          field: "created_at",
          operations: ["greater_than_or_equal", "less_than"],
          params: {
            greater_than_or_equal: "created_after",
            less_than: "created_before",
          },
        },
      ],
      // The endpoint orders by `occurred_at` and takes only the direction.
      sorts: ["occurred_at"],
      sortParam: "order",
      call: ({ client, projectId }, params) =>
        client.listEvents({ project_id: projectId, ...params }),
      items: (page) => page.data,
      next: (page) => page.next_page_token,
    }),
    get: get({
      call: ({ client, projectId }, id) => client.getEvent(id, { project_id: projectId }),
    }),
  }),

  grants: resource({
    group: CommandGroups.usersAndTeams,
    groupOrder: 3,
    singular: "grant",
    idField: "id",
    columns: ["id", "user.user_id", "team.team_id", "relation", "created_at", "expires_at"],
    heading: "id",
    detail: ["user.user_id", "team.team_id", "relation", "object_type", "created_at", "expires_at"],
    list: list({
      body: QueryGrantsBody,
      item: QueryGrantsResponse.shape.grants.element,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "user_id", operations: FILTER_OPERATIONS },
        { field: "team_id", operations: FILTER_OPERATIONS },
        { field: "relation", operations: FILTER_OPERATIONS },
        { field: "expires_at", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "expires_at", "id"],
      call: ({ client, projectId }, body) => client.queryGrants(body, { project_id: projectId }),
      items: (page) => page.grants,
      next: (page) => page.next_page_token,
    }),
    get: get({
      call: ({ client, projectId }, id) => client.getGrant(id, { project_id: projectId }),
      response: GetGrantResponse,
    }),
    create: create(
      CreateGrantBody,
      ({ client, projectId }, body) => client.createGrant(body, { project_id: projectId }),
      // A grant names exactly one of `user` and `team`, which the required
      // fields alone cannot say, so the example names the principal itself.
      { example: "--relation viewer --user-identifier alice@acme.com" },
    ),
    delete: {
      call: ({ client, projectId }, id) => client.deleteGrant(id, { project_id: projectId }),
    },
  }),

  // Identity provider connections (#1217). They carry ADR 063's shape already:
  // a fixed `id` shared by every revision, and a `revision_id` per revision.
  // The revision routes are not modelled here — the CLI has no grammar for a
  // sub-resource listing yet, so `idps revisions` is deliberately absent.
  idps: resource({
    group: CommandGroups.authentication,
    singular: "identity provider connection",
    idField: "id",
    columns: ["id", "slug", "definition.protocol", "definition.display_name", "created_at"],
    heading: "slug",
    detail: ["id", "revision_id", "slug", "created_at", "updated_at"],
    list: list({
      body: QueryIdpsBody,
      item: QueryIdpsResponse.shape.idps.element,
      filters: [
        { field: "slug", operations: FILTER_OPERATIONS },
        { field: "created_at", operations: FILTER_OPERATIONS },
      ],
      sorts: ["slug", "created_at"],
      call: ({ client, projectId }, body) => client.queryIdps(body, { project_id: projectId }),
      items: (page) => page.idps,
      next: (page) => page.next_page_token,
    }),
    get: get({
      call: ({ client, projectId }, id) => client.getIdpById(id, { project_id: projectId }),
      response: GetIdpByIdResponse,
    }),
    // The body nests the connection under `idp`. Rooted there, the flags and
    // `--set` paths address the connection itself (`--oidc-issuer`), and
    // `--file` takes the same document as `.zitadel/idps/<slug>.json`. A slug
    // that already exists is revised rather than duplicated (#1217).
    create: create(
      CreateIdpBody,
      ({ client, projectId }, body) => client.createIdp(body, { project_id: projectId }),
      {
        root: "idp",
        // The `oidc` block is optional to the generated schema, which cannot
        // say that the protocol requires it, so the example spells it out.
        example:
          "--slug acme-sso --protocol oidc --display-name 'Acme SSO' --oidc-issuer https://sso.acme.example --oidc-client-id <client_id> --oidc-client-secret '${{ ACME_SSO_CLIENT_SECRET }}' --oidc-scopes openid --oidc-scopes profile --oidc-scopes email",
      },
    ),
  }),

  projects: resource({
    group: CommandGroups.configuration,
    singular: "project",
    idField: "id",
    columns: ["id", "name", "created_at"],
    heading: "name",
    detail: ["id", "origins", "created_at", "updated_at"],
    list: list({
      body: QueryProjectsBody,
      item: QueryProjectsResponse.shape.projects.element,
      filters: [{ field: "created_at", operations: FILTER_OPERATIONS }],
      sorts: ["created_at"],
      call: ({ client }, body) => client.queryProjects(body),
      items: (page) => page.projects,
      next: (page) => page.next_page_token,
    }),
    get: get({ call: ({ client }, id) => client.getProject(id), response: GetProjectResponse }),
    update: update(PatchProjectBody, ({ client }, id, body) => client.patchProject(id, body)),
  }),

  // Configuration resources (ADR 035) are read-only here. They are authored as
  // files under `.zitadel/` and shipped through a release, so a write verb
  // would be a second writer over the same state; reading what the server
  // currently holds is how you check that a deploy landed.
  schemas: resource({
    group: CommandGroups.configuration,
    singular: "schema",
    idField: "id",
    // Addressed by object type as well as by revision id, so the argument is
    // named for the thing rather than for one of its two spellings.
    idArg: "schema",
    idDescription: "object type (current revision) or revision id",
    columns: ["id", "schema.objectType", "schema.kind", "metadata.created_at"],
    heading: "schema.objectType",
    detail: ["id", "schema.objectType", "schema.kind", "metadata.created_at"],
    list: list({
      item: ListSchemasResponse.shape.schemas.element,
      filters: [
        { field: "object_type", operations: ["equals"] },
        { field: "kind", operations: ["equals"] },
        {
          field: "revisions",
          operations: ["equals"],
          values: ["all", "latest"],
          // Editing a schema mints a new revision rather than changing the old
          // one, so the unfiltered list is a history: the same object type over
          // and over. Someone typing `schemas list` means "what schemas do I
          // have", which is one row each. The console made the same choice.
          default: "latest",
        },
      ],
      call: ({ client, projectId }, params) =>
        client.listSchemas({ ...params, project_id: projectId }),
      items: (page) => page.schemas,
      next: (page) => page.next_page_token,
    }),
    get: get({
      response: GetSchemaByIdResponse,
      // A schema is addressed two ways: a revision id names one immutable
      // revision and fetches directly, an object type resolves to the current
      // revision through the list. A revision id is whatever the customer's
      // `$id` says — `sch_…`, a URL, `urn:example:human`, anything — so there
      // is no shape to test for. Ask the server instead: fetch, and read a 404
      // as "that was an object type". The API has no fetch-by-object-type
      // route yet; when it does, this collapses to one client call like every
      // other `get`.
      call: async ({ client, projectId }, ref) => {
        try {
          return await client.getSchemaById(ref);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) {
            throw error;
          }
        }
        const page = await client.listSchemas({
          project_id: projectId,
          object_type: ref,
          revisions: "latest",
          limit: 1,
        });
        const current = page.schemas[0];
        if (!current) {
          throw new ZitadelError("E_NOT_FOUND", `No schema named "${ref}"`, {
            hint: "Run `schemas list` to see the object types this project has.",
          });
        }
        return current;
      },
    }),
  }),

  release: resource({
    group: CommandGroups.configuration,
    singular: "release",
    idField: "id",
    columns: ["id", "metadata.message", "metadata.git_sha", "revoked_at", "metadata.created_at"],
    heading: "id",
    detail: [
      "id",
      "project_id",
      "content_hash",
      "revoked_at",
      "metadata.message",
      "metadata.git_sha",
      "metadata.git_dirty",
    ],
    list: list({
      item: ListReleasesResponse.shape.releases.element,
      call: ({ client, projectId }, params) =>
        client.listReleases({ ...params, project_id: projectId }),
      items: (page) => page.releases,
      next: (page) => page.next_page_token,
    }),
    get: get({
      call: ({ client, projectId }, id) => client.getReleaseById(id, { project_id: projectId }),
      response: GetReleaseByIdResponse,
      sections: (release) => [releasePointers(release)],
    }),
  }),

  "flow-definitions": resource({
    group: CommandGroups.configuration,
    singular: "flow definition",
    idField: "id",
    // Addressed by flow name as well as by revision id; see `schemas`.
    idArg: "flow",
    idDescription: "flow name (newest revision) or revision id",
    columns: ["id", "flow_definition.name", "flow_definition.status", "created_at"],
    heading: "flow_definition.name",
    detail: ["id", "flow_definition.name", "flow_definition.status", "created_at", "updated_at"],
    list: list({
      item: ListFlowDefinitionsResponse.shape.flow_definitions.element,
      filters: [
        { field: "name", operations: ["equals"] },
        { field: "purpose", operations: ["equals"] },
        {
          field: "revisions",
          operations: ["equals"],
          values: ["all", "latest"],
          // Publishing under an existing name mints a new row (#1246), so the
          // unfiltered list is a history of the same flows. Same reasoning as
          // `schemas`: a bare list is the current flows.
          default: "latest",
        },
      ],
      call: ({ client, projectId }, params) =>
        client.listFlowDefinitions({
          ...params,
          project_id: projectId,
        }),
      items: (page) => page.flow_definitions,
      next: (page) => page.next_page_token,
    }),
    get: get({
      response: GetFlowDefinitionResponse,
      // `flowdef_…` names one revision. Anything else is a flow name, and the
      // endpoint returns that flow's revisions newest first, so the first row
      // is the current one.
      call: async ({ client, projectId }, ref) => {
        if (ref.startsWith("flowdef_")) {
          return client.getFlowDefinition(ref);
        }
        const page = await client.listFlowDefinitions({
          project_id: projectId,
          name: ref,
          limit: 1,
        });
        const current = page.flow_definitions[0];
        if (!current) {
          throw new ZitadelError("E_NOT_FOUND", `No flow definition named "${ref}"`, {
            hint: "Run `flow-definitions list` to see the flows this project has.",
          });
        }
        return current;
      },
    }),
  }),

  branding: resource({
    group: CommandGroups.configuration,
    singular: "branding revision",
    idField: "id",
    columns: ["id", "created_at"],
    heading: "id",
    detail: ["id", "created_at"],
    list: list({
      // `GET /branding` answers with the array itself and takes no cursor, so
      // the paging flags are not generated for it.
      paged: false,
      item: ListBrandingResponse.element,
      call: ({ client, projectId }) => client.listBranding({ project_id: projectId }),
      items: (page) => page,
      next: () => undefined,
    }),
    get: get({
      call: ({ client }, id) => client.getBrandingById(id),
      response: GetBrandingByIdResponse,
    }),
  }),

  // Operation policies (ADR 066). Configuration: carried from
  // .zitadel/policies/ by `deploy`, so only read here (`policies test` is a
  // hand-written command). A project has one
  // policy per operation, and the list shows each at its newest revision.
  // The revision routes are not modelled, for the reason `idps` gives.
  policies: resource({
    group: CommandGroups.configuration,
    singular: "policy",
    idField: "id",
    // Addressed by operation as well as by id: the operation is what the
    // file is named after and what a developer knows the policy by.
    idArg: "policy",
    idDescription: "policy id or operation",
    columns: ["id", "operation", "revision_id", "updated_at"],
    heading: "operation",
    detail: ["id", "operation", "config", "revision_id", "project_id", "created_at", "updated_at"],
    list: list({
      item: ListPoliciesResponse.shape.policies.element,
      filters: [{ field: "operation", operations: ["equals"] }],
      call: ({ client, projectId }, params) =>
        client.listPolicies({ ...params, project_id: projectId }),
      items: (page) => page.policies,
      next: (page) => page.next_page_token,
    }),
    get: get({
      response: GetPolicyResponse,
      // An id names the policy; a catalogued operation resolves through the
      // list's filter, which answers with the operation's policy or nothing.
      // Anything else names no policy: sending it as the filter would be
      // refused as a malformed query rather than reported as not found.
      call: async ({ client, projectId }, ref) => {
        if (ref.startsWith("pol_")) {
          return client.getPolicy(ref, { project_id: projectId });
        }
        const notFound = () =>
          new ZitadelError("E_NOT_FOUND", `No policy for "${ref}"`, {
            hint: `Run \`policies list\` to see the project's policies. A policy is addressed by its id or its operation (${POLICY_OPERATIONS.join(", ")}).`,
          });
        const operation = POLICY_OPERATIONS.find((known) => known === ref);
        if (operation === undefined) {
          throw notFound();
        }
        const page = await client.listPolicies({ project_id: projectId, operation, limit: 1 });
        const current = page.policies[0];
        if (!current) {
          throw notFound();
        }
        return current;
      },
    }),
  }),
} satisfies CheckedRegistry;

/**
 * The `<resource> <verb>` commands, ready for the explicit command table. They
 * connect like every command that talks to a project (see
 * `EnvironmentCommand`), so they take `--env` and `--env-file` too.
 */
export const RESOURCE_COMMANDS = buildResourceCommands<Platform>(RESOURCES, {
  operations: FILTER_OPERATIONS,
  // A `${{ NAME }}` reference to a project variable (ADR 062) names a
  // credential without revealing it, and is the only form a connection's
  // `client_secret` takes, so it may stand on a command line.
  references: { matches: isVariableReference, example: "'${{ NAME }}'" },
  connect: async (open) => {
    const { client, projectId } = await open();
    return { client, projectId };
  },
});
