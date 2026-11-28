import type { Interfaces } from "@oclif/core";
import { isVariableReference } from "@zitadel/config/idp";

import {
  BrandingService,
  FlowService,
  type OperationName,
  PolicyService,
  pagedFunctions,
  SchemaService,
  type ZitadelClient,
} from "@/lib/backend";
import {
  type GetRelease200,
  ListEventsCategoryItem,
  ListEventsStatusClassItem,
  ListFlowDefinitionsRevisions,
  ListSchemasRevisions,
  QueryGrantsBodyFilterItemOperation,
  QueryApplicationsBodyFilterItemOperation,
  QueryIdpsBodyFilterItemOperation,
  QueryProjectsBodyFilterItemOperation,
  QuerySessionsBodyFilterItemOperation,
  QueryTeamsBodyFilterItemOperation,
  QueryUsersBodyFilterItemOperation,
} from "@/lib/backend/model";
import {
  CreateGrantBody,
  PublishIdpBody,
  CreateTeamBody,
  CreateUserBody,
  GetBrandingResponse,
  GetFlowDefinitionResponse,
  GetGrantResponse,
  GetApplicationResponse,
  GetIdpResponse,
  GetPolicyResponse,
  GetProjectResponse,
  GetReleaseParams,
  GetReleaseResponse,
  GetSchemaResponse,
  GetSessionParams,
  GetSessionResponse,
  GetTeamResponse,
  GetUserParams,
  GetUserResponse,
  ListBrandingResponse,
  ListEventsResponse,
  ListFlowDefinitionsResponse,
  ListPoliciesResponse,
  ListReleasesResponse,
  ListSchemasResponse,
  UpdateProjectBody,
  UpdateUserBody,
  PublishPolicyBody,
  QueryGrantsBody,
  QueryGrantsResponse,
  QueryApplicationsBody,
  QueryApplicationsResponse,
  QueryIdpsBody,
  QueryIdpsResponse,
  QueryProjectsBody,
  QueryProjectsResponse,
  QuerySessionsBody,
  QuerySessionsResponse,
  QueryTeamsBody,
  QueryTeamsResponse,
  QueryUsersBody,
  QueryUsersResponse,
  UpdateTeamBody,
} from "@/lib/backend/schemas";
import { ZitadelError } from "@/lib/errors";
import type { LooseArgs } from "@/lib/suggestion";
import {
  buildResourceCommands,
  type CreateSpec,
  type FieldPath,
  type FilterField,
  type GetSpec,
  type Json,
  type ListSpec,
  type ResourceDescriptor,
  type ResourceRegistry,
  type Schema,
  type UpdateSpec,
  type WriteResult,
  type WriteShape,
} from "@/cli/core/crud";
import { CommandGroups } from "@/cli/commands/groups";
import type { Tabulate } from "@/cli/core/tabulatable";
import { ServerCommand } from "@/cli/commands/server-command";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** A user update's body as its flags write it: `--dry-run` sets `dry_run`. */
const USER_UPDATE_BODY = UpdateUserBody.omit({ dry_run: true });

/**
 * The platform connection every resource verb calls through: the typed
 * client bound to the resolved server, plus the project the credential
 * belongs to. Endpoints that scope by `project_id` read it
 * from here; the flag surface never exposes it.
 */
export type Platform = Readonly<{ client: ZitadelClient; projectId: string }>;

/**
 * Builds a resource's `create` verb, inferring the body type from its Zod
 * schema so `call` gets the typed body straight from `parseOrThrow`, with no
 * cast from `Json`.
 *
 * @param schema The schema the body is parsed with.
 * @param call Sends the parsed body to the platform.
 * @param shape How the verb's flags and examples are shaped.
 * @returns The verb's spec.
 */
export const create = <B, C>(
  schema: Schema<B>,
  call: (ctx: Platform, body: B) => Promise<C>,
  shape: WriteShape = {},
): NoInfer<CreateSpec<Platform, B, C>> => {
  return {
    ...shape,
    schema,
    call,
  };
};

/**
 * Builds a resource's `update` verb, inferring the body type from its Zod
 * schema like `create` does.
 *
 * @param schema The schema the body is parsed with.
 * @param call Sends the id and the parsed body to the platform.
 * @param shape How the verb's flags and examples are shaped, and its `check`.
 * @returns The verb's spec.
 */
export const update = <B, U>(
  schema: Schema<B>,
  call: (ctx: Platform, id: string, body: B) => Promise<U>,
  shape: WriteShape & Pick<UpdateSpec<Platform, B, U>, "check"> = {},
): NoInfer<UpdateSpec<Platform, B, U>> => {
  return {
    ...shape,
    schema,
    call,
  };
};

/**
 * Marks a descriptor `resource()` checked; `RESOURCES` takes no other, so an
 * entry written as a plain object cannot skip the checks.
 */
const checked = Symbol("checked");

/** Carries, for the type system alone, the verbs a descriptor's commands take. */
declare const verbs: unique symbol;

/**
 * The verbs a resource's commands take, from its descriptor as written: `list`
 * and `get` always, `create` and `update` when it has them, and its delete
 * under the verb that delete is named by (`revoke`, `deactivate`).
 */
type VerbsOf<Ops> =
  | "list"
  | "get"
  | (Ops extends { readonly create: object } ? "create" : never)
  | (Ops extends { readonly update: object } ? "update" : never)
  | (Ops extends { readonly delete: infer Delete }
      ? Delete extends { readonly verb: infer Verb extends string }
        ? Verb
        : Delete extends object
          ? "delete"
          : never
      : never);
type Checked = ResourceDescriptor<Platform> & { readonly [checked]: true };

/** A registry of descriptors `resource()` checked: the type `RESOURCES` satisfies. */
export type CheckedRegistry = ResourceRegistry<Platform> & Readonly<Record<string, Checked>>;

/**
 * The fields of `T`, each of any type: what a response schema must parse into
 * at least. A schema copied from another operation names other fields. The
 * types below them may differ: a schema applies the spec's defaults, and types
 * a recursive field as `unknown` where the generated type spells it out.
 */
type FieldsOf<T> = { [K in keyof T]: unknown };

/**
 * What a write must answer with: a record carrying the resource's id under
 * `Id`, or the empty answer `WriteResult` allows (`grant create` by
 * identifier answers 202).
 */
type Written<Id extends string> = Readonly<Record<Id, unknown>> | Exclude<WriteResult, Json>;

/** One entry of a structured query's `filter`, the source of what it filters by. */
type BodyFilter<B> = B extends { filter?: readonly (infer F)[] | null } ? F : never;

/** The enum of a structured query's `filter[].field`. */
type BodyFilterField<B> = BodyFilter<B> extends { field: infer N } ? N & string : never;

/** The enum of a structured query's `filter[].operation`. */
type BodyFilterOperation<B> = BodyFilter<B> extends { operation: infer O } ? O & string : never;

/** The enum of a structured query's `sorting.field`. */
type BodySortField<B> = B extends { sorting?: infer S }
  ? NonNullable<S> extends { field: infer N }
    ? N & string
    : never
  : never;

/**
 * A structured query's filter: a field and operations its body takes. The body
 * carries every value as one free-form scalar, so `values` and `default` are
 * plain strings, and repeats of a field all apply, so none widens.
 */
type QueryFilter<B> = FilterField & {
  readonly field: BodyFilterField<B>;
  readonly operations: readonly BodyFilterOperation<B>[];
  readonly combine?: undefined;
};

/** What a `GET` query parameter takes: one entry of it, when it repeats. */
type ParamValue<V> = NonNullable<V> extends readonly (infer E)[] ? E : NonNullable<V>;

/**
 * A `GET` list's filter: a query parameter, which carries a value as it is and
 * so filters only by `equals`, and whose `values` and `default` are of the type
 * it takes; or a range, sent as one parameter per operation, which only
 * `range()` makes. A parameter that takes a list widens with each repeat, so
 * it says so, and one that takes a single value cannot.
 */
type GetFilter<B> =
  | {
      [K in keyof B & string]: FilterField & {
        readonly field: K;
        readonly operations: readonly "equals"[];
        readonly params?: undefined;
        readonly values?: readonly (ParamValue<B[K]> & string)[];
        readonly default?: ParamValue<B[K]> & string;
      } & (NonNullable<B[K]> extends readonly unknown[]
          ? { readonly combine: "or" }
          : { readonly combine?: undefined });
    }[keyof B & string]
  | (FilterField & {
      readonly params: Readonly<Record<string, keyof B & string>>;
      readonly combine?: undefined;
      readonly [ranged]: true;
    });

/**
 * Marks the operations and parameters `range()` paired; a `GET` list takes no
 * other range, so none can offer an operation it has no parameter for.
 */
const ranged = Symbol("ranged");

/**
 * A field a `GET` list sends as one parameter per operation (a range, such as
 * `created_after` and `created_before`), keyed by operation: the operations it
 * offers are the keys, so each has the parameter it travels as.
 */
export const range = <const M extends { readonly [O in Operation]?: string }>(
  params: M & { readonly [K in Exclude<keyof M, Operation>]: never },
) => {
  return {
    operations: Object.keys(params),
    params,
    [ranged]: true as const,
  };
};

/**
 * A list's filters and sorts, checked against the request it sends. A list with
 * a `body` is a structured query, sorted by a field the body names. A `GET` list
 * orders by one implicit field of its item, so its sort names that field, and
 * `sortParam` the parameter carrying the direction.
 */
type QueryList<B> = Readonly<{
  body: Schema<B>;
  filters?: readonly NoInfer<QueryFilter<B>>[];
  sorts?: readonly NoInfer<BodySortField<B>>[];
  sortParam?: undefined;
}>;
/**
 * A `GET` list whose call parameter is untyped has a request of any key, which
 * would check nothing, so it takes no filters or `sortParam` at all.
 */
type GetList<B, T> = Readonly<{
  body?: undefined;
  filters?: string extends keyof B ? never : readonly NoInfer<GetFilter<B>>[];
  sorts?: readonly NoInfer<FieldPath<T>>[];
  sortParam?: string extends keyof B ? never : NoInfer<keyof B & string>;
}>;

/** What a `GET` list's call takes: the client function's query, less what the platform fills. */
type Query<K extends OperationName> = Omit<
  NonNullable<Parameters<ZitadelClient[K]>[0]>,
  "project_id"
>;

/**
 * Builds a resource's `list` verb. Infers a list's page `P` from `call` and its
 * item `T` from `items`, which reads the list off that page, and checks `item`
 * against `T`. Infers a structured query's request type `B` from its `body`
 * schema, and a `GET` list's from its call's parameter, which must be typed
 * (`params: Query<"listX">`) for the list to take filters or a `sortParam`.
 * `items` comes after `call`, so the page is known when `items` is read.
 *
 * @param spec The list as written.
 * @returns The same spec, typed.
 */
export const list = <B = Json, P = unknown, T = unknown, S extends FieldsOf<T> = FieldsOf<T>>(
  spec: ListSpec<Platform, B, P, T> & { item?: Schema<S> } & (QueryList<B> | GetList<B, T>),
): NoInfer<ListSpec<Platform, B, P, T>> => {
  return spec;
};

/**
 * Builds a resource's `get` verb, inferring the record it answers with so
 * `sections` reads it typed.
 *
 * @param spec The verb as written.
 * @returns The same spec, typed.
 */
export const get = <R, S extends FieldsOf<R> = FieldsOf<R>>(
  spec: GetSpec<Platform, R> & { response?: Schema<S> },
): NoInfer<GetSpec<Platform, R>> => {
  return spec;
};

/**
 * Checks a resource's paths against what its verbs answer with: `columns` name
 * fields of a listed item, `heading` and `detail` fields of the record `get`
 * answers with, and `idField` a field of both that `create` and `update`
 * answer with. It builds `idOf` from `idField`, the typed read a write's
 * suggested `get` takes its id from.
 *
 * @typeParam Ops The descriptor as written, so the command table knows which
 * verbs it has.
 * @param descriptor The resource as written.
 * @returns The descriptor, marked checked.
 */
export const resource = <
  P,
  T,
  R,
  B extends Json,
  CB extends Json,
  UB extends Json,
  Id extends keyof T & keyof R & string,
  Ops extends Readonly<{ create?: unknown; update?: unknown; delete?: unknown }>,
>(
  descriptor: Ops &
    Omit<
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
): Checked & { readonly get: GetSpec<Platform, R> } & Readonly<{ [verbs]?: VerbsOf<Ops> }> => {
  return {
    ...descriptor,
    idOf: (written: Readonly<Record<Id, unknown>>) => {
      return written[descriptor.idField];
    },
    [checked]: true,
  };
};

/**
 * The filter operations each `POST /<resource>/query` endpoint takes (ADR 031),
 * from its own body's enum, so a query that gains one offers it. `starts_with`
 * is in every body's enum, but only the fields that name it take it, so those
 * list it themselves.
 *
 * @param operations The operation enum of one query's body.
 * @returns Every operation in it but `starts_with`.
 */
const general = <O extends string>(operations: Readonly<Record<string, O>>): O[] => {
  return Object.values(operations).filter((operation) => {
    return operation !== "starts_with";
  });
};
const USER_OPERATIONS = general(QueryUsersBodyFilterItemOperation);
const TEAM_OPERATIONS = general(QueryTeamsBodyFilterItemOperation);
const SESSION_OPERATIONS = general(QuerySessionsBodyFilterItemOperation);
const GRANT_OPERATIONS = general(QueryGrantsBodyFilterItemOperation);
const IDP_OPERATIONS = general(QueryIdpsBodyFilterItemOperation);
const APPLICATION_OPERATIONS = general(QueryApplicationsBodyFilterItemOperation);
const PROJECT_OPERATIONS = general(QueryProjectsBodyFilterItemOperation);

/** A filter operation any of the API's structured queries takes. */
type Operation =
  | QueryUsersBodyFilterItemOperation
  | QueryTeamsBodyFilterItemOperation
  | QuerySessionsBodyFilterItemOperation
  | QueryGrantsBodyFilterItemOperation
  | QueryIdpsBodyFilterItemOperation
  | QueryApplicationsBodyFilterItemOperation
  | QueryProjectsBodyFilterItemOperation;

/** Every filter operation the API knows, so `--filter` tells one from a value. */
const OPERATIONS: readonly Operation[] = [
  ...new Set<Operation>([
    ...Object.values(QueryUsersBodyFilterItemOperation),
    ...Object.values(QueryTeamsBodyFilterItemOperation),
    ...Object.values(QuerySessionsBodyFilterItemOperation),
    ...Object.values(QueryGrantsBodyFilterItemOperation),
    ...Object.values(QueryIdpsBodyFilterItemOperation),
    ...Object.values(QueryApplicationsBodyFilterItemOperation),
    ...Object.values(QueryProjectsBodyFilterItemOperation),
  ]),
];

/** A release's pointers as an indented table, one pinned revision per row. */
export const releasePointers = async (
  release: Pick<GetRelease200, "pointers">,
  tabulate: Tabulate,
): Promise<string> => {
  const { pointers } = release;
  const table = (await tabulate(["kind", "handle", "revision_id"], pointers))
    .split("\n")
    .map((line) => {
      return `  ${line}`;
    });
  return ["resources", ...table].join("\n");
};

/** The operations a policy can guard, as the generated publish body names them. */
const POLICY_OPERATIONS = PublishPolicyBody.options.flatMap(
  (branch) => branch.shape.operation.options,
);

/**
 * The runtime resources the CLI manages imperatively — one entry per topic.
 * Config resources (schemas, flows, branding, releases) are deliberately
 * absent: they are published from `.zitadel/**` through `deploy`
 * (ADR 007, ADR 035), and an imperative write path would fork that source of
 * truth. Adding a backend resource is adding an entry here.
 *
 * Config resources (ADR 035) are read-only here: they are authored as files
 * under `.zitadel/` and shipped through a release, so a write verb would be a
 * second writer over the same state, and reading what the server currently
 * holds is how you check that a deploy landed.
 *
 * A user's `identifier` is their login handle (their email under the default
 * schema), which is why it is a column where the schema URL it replaced, being
 * identical on every row, is not. The users query sends no `project_id`: it
 * defaults to the token's own project, the only one a project secret can list.
 * A user update's `dry_run` is the global `--dry-run`'s, never a body field of
 * its own, and its `check` runs the update with `dry_run` set because a server
 * from before `dry_run` refuses the field rather than applying the patch, so a
 * dry run needs no check of the server first.
 *
 * A team's DELETE deactivates it and leaves it readable (ADR 024), so its
 * command is named after that rather than claiming the team is gone. A
 * session's endpoint terminates it rather than removing a record, so its
 * command says `revoke`: `delete` would tell the caller it is gone.
 *
 * `GET /events` spells its filters as flat query parameters, and a range as
 * two of them. Declaring the parameter each operation travels as lets the
 * caller write the same `field=operation:value` they write for every other
 * resource, with no grammar invented that the endpoint cannot honour. It
 * orders by `occurred_at` and takes only the direction.
 *
 * A grant names exactly one of `user` and `team`, which the required fields
 * alone cannot say, so its create example names the principal itself.
 *
 * Identity provider connections carry ADR 063's shape already: a fixed `id`
 * shared by every revision, and a `revision_id` per revision. The revision
 * routes are not modelled, because the CLI has no grammar for a sub-resource
 * listing yet, so `idp revisions` is deliberately absent. The create body nests
 * the connection under `idp`; rooted there, the flags and `--set` paths address
 * the connection itself (`--oidc-issuer`), and `--file` takes the same document
 * as `.zitadel/idps/<slug>.json`. A slug that already exists is revised rather
 * than duplicated. The generated schema makes the `oidc` block optional because
 * it cannot say that the protocol requires it, so the create example spells it
 * out.
 *
 * Applications are only read here. A declared application is a file,
 * `.zitadel/applications/<slug>.json`, that `deploy` ships (ADR 082 §3), so
 * this entry declares no create.
 *
 * A schema, a flow definition and a policy are addressed by a name as well as
 * by an id (object type, flow name, operation), so their argument is named for
 * the thing rather than for one of its spellings: the operation is what a
 * policy's file is named after and what a developer knows it by. Editing a
 * schema mints a new revision rather than changing the old one, and publishing
 * a flow under an existing name mints a new row, so their unfiltered lists are
 * histories of the same objects. Someone typing `schema list` means "what
 * schemas do I have", which is one row each, so `revisions` defaults to the
 * latest (the console made the same choice).
 *
 * Operation policies (ADR 066) are carried from `.zitadel/policies/` by
 * `deploy`, so only read here (`policy test` is a hand-written command). A
 * project has one policy per operation, and the list shows each at its newest
 * revision; the revision routes are not modelled, for the reason `idp` gives.
 * A policy id names the policy; a catalogued operation resolves through the
 * list's filter, which answers with the operation's policy or nothing. Anything
 * else names no policy: sending it as the filter would be refused as a
 * malformed query rather than reported as not found.
 */
export const RESOURCES = {
  user: resource({
    group: CommandGroups.usersAndAccess,
    groupOrder: 1,
    singular: "user",
    kind: "user",
    idSchema: GetUserParams.shape.user_id,
    idField: "id",
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
        {
          field: "created_at",
          operations: USER_OPERATIONS,
        },
        {
          field: "id",
          operations: USER_OPERATIONS,
        },
        {
          field: "identifier",
          operations: ["starts_with"],
        },
        {
          field: "schema",
          operations: USER_OPERATIONS,
        },
        {
          field: "schema_object_type",
          operations: ["equals", "not_equals", "contains"],
        },
        {
          field: "status",
          operations: USER_OPERATIONS,
        },
        {
          field: "team_id",
          operations: USER_OPERATIONS,
        },
        {
          field: "lifecycle_owner_team_id",
          operations: USER_OPERATIONS,
        },
      ],
      sorts: ["created_at", "id", "schema", "status", "lifecycle_owner_team_id"],
      call: ({ client }, body) => {
        return client.queryUsers(body);
      },
      items: pagedFunctions.queryUsers.items,
      next: pagedFunctions.queryUsers.next,
    }),
    get: get({
      call: ({ client }, id) => {
        return client.getUser(id);
      },
      response: GetUserResponse,
    }),
    create: create(CreateUserBody, ({ client, projectId }, body) => {
      return client.createUser(body, { project_id: projectId });
    }),
    update: update(
      USER_UPDATE_BODY,
      ({ client }, id, body) => {
        return client.updateUser(id, body);
      },
      {
        check: ({ client }, id, body) => {
          return client.updateUser(id, {
            ...body,
            dry_run: true,
          });
        },
      },
    ),
    delete: {
      call: ({ client }, id) => {
        return client.deleteUser(id);
      },
    },
  }),

  team: resource({
    group: CommandGroups.usersAndAccess,
    groupOrder: 2,
    singular: "team",
    kind: "team",
    idField: "id",
    columns: ["id", "name", "status", "created_at"],
    heading: "name",
    detail: ["id", "status", "created_at", "updated_at"],
    list: list({
      body: QueryTeamsBody,
      item: QueryTeamsResponse.shape.teams.element,
      filters: [
        {
          field: "created_at",
          operations: TEAM_OPERATIONS,
        },
        {
          field: "name",
          operations: TEAM_OPERATIONS,
        },
        {
          field: "status",
          operations: TEAM_OPERATIONS,
        },
      ],
      sorts: ["created_at", "name", "status"],
      call: ({ client, projectId }, body) => {
        return client.queryTeams(body, { project_id: projectId });
      },
      items: pagedFunctions.queryTeams.items,
      next: pagedFunctions.queryTeams.next,
    }),
    get: get({
      call: ({ client }, id) => {
        return client.getTeam(id);
      },
      response: GetTeamResponse,
    }),
    create: create(CreateTeamBody, ({ client, projectId }, body) => {
      return client.createTeam(body, { project_id: projectId });
    }),
    update: update(UpdateTeamBody, ({ client }, id, body) => {
      return client.updateTeam(id, body);
    }),
    delete: {
      verb: "deactivate",
      call: ({ client }, id) => {
        return client.deactivateTeam(id);
      },
    },
  }),

  session: resource({
    group: CommandGroups.usersAndAccess,
    groupOrder: 4,
    singular: "session",
    idSchema: GetSessionParams.shape.session_id,
    idField: "session_id",
    columns: ["session_id", "state", "user_id", "created_at", "expires_at"],
    heading: "session_id",
    detail: ["project_id", "state", "user_id", "created_at", "expires_at"],
    list: list({
      body: QuerySessionsBody,
      item: QuerySessionsResponse.shape.sessions.element,
      filters: [
        {
          field: "created_at",
          operations: SESSION_OPERATIONS,
        },
        {
          field: "user_id",
          operations: SESSION_OPERATIONS,
        },
        {
          field: "state",
          operations: SESSION_OPERATIONS,
        },
        {
          field: "lifecycle_owner_team_id",
          operations: SESSION_OPERATIONS,
        },
      ],
      sorts: ["created_at", "user_id"],
      call: ({ client, projectId }, body) => {
        return client.querySessions(body, { project_id: projectId });
      },
      items: pagedFunctions.querySessions.items,
      next: pagedFunctions.querySessions.next,
    }),
    get: get({
      call: ({ client }, id) => {
        return client.getSession(id);
      },
      response: GetSessionResponse,
    }),
    delete: {
      verb: "revoke",
      call: ({ client }, id) => {
        return client.revokeSession(id);
      },
    },
  }),

  event: resource({
    group: CommandGroups.apiAndEvents,
    groupOrder: 1,
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
      "user_id",
      "request_id",
      "occurred_at",
    ],
    list: list({
      item: ListEventsResponse.shape.events.element,
      filters: [
        {
          field: "category",
          operations: ["equals"],
          values: Object.values(ListEventsCategoryItem),
          combine: "or",
        },
        {
          field: "event_type",
          operations: ["equals"],
          combine: "or",
        },
        {
          field: "actor_id",
          operations: ["equals"],
        },
        {
          field: "user_id",
          operations: ["equals"],
        },
        {
          field: "session_id",
          operations: ["equals"],
        },
        {
          field: "flow_id",
          operations: ["equals"],
        },
        {
          field: "correlation_id",
          operations: ["equals"],
        },
        {
          field: "request_id",
          operations: ["equals"],
        },
        {
          field: "entity_type",
          operations: ["equals"],
        },
        {
          field: "entity_id",
          operations: ["equals"],
        },
        {
          field: "team_id",
          operations: ["equals"],
        },
        {
          field: "operation_id",
          operations: ["equals"],
          combine: "or",
        },
        {
          field: "status_class",
          operations: ["equals"],
          values: Object.values(ListEventsStatusClassItem),
          combine: "or",
        },
        {
          field: "created_at",
          ...range({
            greater_than_or_equal: "created_after",
            less_than: "created_before",
          }),
        },
      ],
      sorts: ["occurred_at"],
      sortParam: "order",
      call: ({ client, projectId }: Platform, params: Query<"listEvents">) => {
        return client.listEvents({
          project_id: projectId,
          ...params,
        });
      },
      items: pagedFunctions.listEvents.items,
      next: pagedFunctions.listEvents.next,
    }),
    get: get({
      call: ({ client, projectId }, id) => {
        return client.getEvent(id, { project_id: projectId });
      },
    }),
  }),

  grant: resource({
    group: CommandGroups.usersAndAccess,
    groupOrder: 3,
    singular: "grant",
    kind: "grant",
    idField: "id",
    columns: ["id", "user.user_id", "team.team_id", "relation", "created_at", "expires_at"],
    heading: "id",
    detail: ["user.user_id", "team.team_id", "relation", "object_type", "created_at", "expires_at"],
    list: list({
      body: QueryGrantsBody,
      item: QueryGrantsResponse.shape.grants.element,
      filters: [
        {
          field: "created_at",
          operations: GRANT_OPERATIONS,
        },
        {
          field: "user_id",
          operations: GRANT_OPERATIONS,
        },
        {
          field: "team_id",
          operations: GRANT_OPERATIONS,
        },
        {
          field: "relation",
          operations: GRANT_OPERATIONS,
        },
        {
          field: "expires_at",
          operations: GRANT_OPERATIONS,
        },
      ],
      sorts: ["created_at", "expires_at", "id"],
      call: ({ client, projectId }, body) => {
        return client.queryGrants(body, { project_id: projectId });
      },
      items: pagedFunctions.queryGrants.items,
      next: pagedFunctions.queryGrants.next,
    }),
    get: get({
      call: ({ client, projectId }, id) => {
        return client.getGrant(id, { project_id: projectId });
      },
      response: GetGrantResponse,
    }),
    create: create(
      CreateGrantBody,
      ({ client, projectId }, body) => {
        return client.createGrant(body, { project_id: projectId }).then((grant) => {
          return grant ?? undefined;
        });
      },
      {
        example: "--relation viewer --user-identifier alice@acme.com",
        facts: (body) => {
          return { access_level: typeof body.relation === "string" ? body.relation : undefined };
        },
      },
    ),
    delete: {
      call: ({ client, projectId }, id) => {
        return client.deleteGrant(id, { project_id: projectId });
      },
    },
  }),

  idp: resource({
    group: CommandGroups.signIn,
    groupOrder: 2,
    singular: "identity provider connection",
    plural: "identity provider connections",
    idField: "id",
    columns: ["id", "slug", "definition.protocol", "definition.display_name", "created_at"],
    heading: "slug",
    detail: ["id", "revision_id", "slug", "created_at", "updated_at"],
    list: list({
      body: QueryIdpsBody,
      item: QueryIdpsResponse.shape.idps.element,
      filters: [
        {
          field: "slug",
          operations: IDP_OPERATIONS,
        },
        {
          field: "created_at",
          operations: IDP_OPERATIONS,
        },
      ],
      sorts: ["slug", "created_at"],
      call: ({ client, projectId }, body) => {
        return client.queryIdps(body, { project_id: projectId });
      },
      items: pagedFunctions.queryIdps.items,
      next: pagedFunctions.queryIdps.next,
    }),
    get: get({
      call: ({ client, projectId }, id) => {
        return client.getIdp(id, { project_id: projectId });
      },
      response: GetIdpResponse,
    }),
    create: create(
      PublishIdpBody,
      ({ client, projectId }, body) => {
        return client.publishIdp(body, { project_id: projectId });
      },
      {
        root: "idp",
        example:
          "--slug acme-sso --protocol oidc --display-name 'Acme SSO' --oidc-issuer https://sso.acme.example --oidc-client-id <client_id> --oidc-client-secret '${{ ACME_SSO_CLIENT_SECRET }}' --oidc-scopes openid --oidc-scopes profile --oidc-scopes email",
      },
    ),
  }),

  application: resource({
    group: CommandGroups.signIn,
    groupOrder: 7,
    singular: "application",
    idField: "id",
    columns: ["id", "slug", "definition.name", "declared", "created_at"],
    heading: "slug",
    detail: ["id", "revision_id", "slug", "declared", "created_at", "updated_at"],
    list: list({
      body: QueryApplicationsBody,
      item: QueryApplicationsResponse.shape.applications.element,
      filters: [
        {
          field: "slug",
          operations: APPLICATION_OPERATIONS,
        },
        {
          field: "created_at",
          operations: APPLICATION_OPERATIONS,
        },
      ],
      sorts: ["slug", "created_at"],
      call: ({ client, projectId }, body) => {
        return client.queryApplications(body, { project_id: projectId });
      },
      items: pagedFunctions.queryApplications.items,
      next: pagedFunctions.queryApplications.next,
    }),
    get: get({
      call: ({ client, projectId }, id) => {
        return client.getApplication(id, { project_id: projectId });
      },
      response: GetApplicationResponse,
    }),
  }),

  project: resource({
    group: CommandGroups.projectSettings,
    groupOrder: 1,
    singular: "project",
    idField: "id",
    columns: ["id", "name", "created_at"],
    heading: "name",
    detail: ["id", "origins", "created_at", "updated_at"],
    list: list({
      body: QueryProjectsBody,
      item: QueryProjectsResponse.shape.projects.element,
      filters: [
        {
          field: "created_at",
          operations: PROJECT_OPERATIONS,
        },
      ],
      sorts: ["created_at"],
      call: ({ client }, body) => {
        return client.queryProjects(body);
      },
      items: pagedFunctions.queryProjects.items,
      next: pagedFunctions.queryProjects.next,
    }),
    get: get({
      call: ({ client }, id) => {
        return client.getProject(id);
      },
      response: GetProjectResponse,
    }),
    update: update(UpdateProjectBody, ({ client }, id, body) => {
      return client.updateProject(id, body);
    }),
  }),

  schema: resource({
    group: CommandGroups.signIn,
    groupOrder: 3,
    singular: "schema",
    idField: "id",
    idArg: "schema",
    idDescription: "object type (current revision) or revision id",
    columns: ["id", "schema.objectType", "schema.kind", "metadata.created_at"],
    heading: "schema.objectType",
    detail: ["id", "schema.objectType", "schema.kind", "metadata.created_at"],
    list: list({
      item: ListSchemasResponse.shape.schemas.element,
      filters: [
        {
          field: "object_type",
          operations: ["equals"],
        },
        {
          field: "kind",
          operations: ["equals"],
        },
        {
          field: "revisions",
          operations: ["equals"],
          values: Object.values(ListSchemasRevisions),
          default: ListSchemasRevisions.latest,
        },
      ],
      call: ({ client, projectId }: Platform, params: Query<"listSchemas">) => {
        const schemaService = new SchemaService(client, projectId);
        return schemaService.page(params);
      },
      items: (page) => {
        return page.items;
      },
      next: (page) => {
        return page.next;
      },
    }),
    get: get({
      response: GetSchemaResponse,
      call: ({ client, projectId }, reference) => {
        const schemaService = new SchemaService(client, projectId);
        return schemaService.get(reference);
      },
    }),
  }),

  release: resource({
    group: CommandGroups.releases,
    groupOrder: 4,
    singular: "release",
    plural: "releases",
    idSchema: GetReleaseParams.shape.release_id,
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
      call: ({ client, projectId }: Platform, params: Query<"listReleases">) => {
        return client.listReleases({
          ...params,
          project_id: projectId,
        });
      },
      items: pagedFunctions.listReleases.items,
      next: pagedFunctions.listReleases.next,
    }),
    get: get({
      call: ({ client, projectId }, id) => {
        return client.getRelease(id, { project_id: projectId });
      },
      response: GetReleaseResponse,
      sections: async (release, tabulate) => {
        return [await releasePointers(release, tabulate)];
      },
    }),
  }),

  "flow-definition": resource({
    group: CommandGroups.signIn,
    groupOrder: 5,
    singular: "flow definition",
    plural: "flow definitions",
    idField: "id",
    idArg: "flow",
    idDescription: "flow name (newest revision) or revision id",
    columns: ["id", "flow_definition.name", "created_at"],
    heading: "flow_definition.name",
    detail: ["id", "flow_definition.name", "created_at", "updated_at"],
    list: list({
      item: ListFlowDefinitionsResponse.shape.flow_definitions.element,
      filters: [
        {
          field: "name",
          operations: ["equals"],
        },
        {
          field: "purpose",
          operations: ["equals"],
        },
        {
          field: "revisions",
          operations: ["equals"],
          values: Object.values(ListFlowDefinitionsRevisions),
          default: ListFlowDefinitionsRevisions.latest,
        },
      ],
      call: ({ client, projectId }: Platform, params: Query<"listFlowDefinitions">) => {
        const flowService = new FlowService(client, projectId);
        return flowService.page(params);
      },
      items: (page) => {
        return page.items;
      },
      next: (page) => {
        return page.next;
      },
    }),
    get: get({
      response: GetFlowDefinitionResponse,
      call: ({ client, projectId }, reference) => {
        const flowService = new FlowService(client, projectId);
        return flowService.get(reference);
      },
    }),
  }),

  branding: resource({
    group: CommandGroups.signIn,
    groupOrder: 4,
    singular: "branding revision",
    plural: "branding revisions",
    idField: "id",
    columns: ["id", "created_at"],
    heading: "id",
    detail: ["id", "created_at"],
    list: list({
      item: ListBrandingResponse.shape.branding.element,
      call: ({ client, projectId }: Platform, params: Query<"listBranding">) => {
        const brandingService = new BrandingService(client, projectId);
        return brandingService.page(params);
      },
      items: (page) => {
        return page.items;
      },
      next: (page) => {
        return page.next;
      },
    }),
    get: get({
      call: ({ client, projectId }, id) => {
        const brandingService = new BrandingService(client, projectId);
        return brandingService.get(id);
      },
      response: GetBrandingResponse,
    }),
  }),

  policy: resource({
    group: CommandGroups.signIn,
    groupOrder: 6,
    singular: "policy",
    idField: "id",
    idArg: "policy",
    idDescription: "policy id or operation",
    columns: ["id", "operation", "revision_id", "updated_at"],
    heading: "operation",
    detail: ["id", "operation", "config", "revision_id", "project_id", "created_at", "updated_at"],
    list: list({
      item: ListPoliciesResponse.shape.policies.element,
      filters: [
        {
          field: "operation",
          operations: ["equals"],
        },
      ],
      call: ({ client, projectId }: Platform, params: Query<"listPolicies">) => {
        const policyService = new PolicyService(client, projectId);
        return policyService.page(params);
      },
      items: (page) => {
        return page.items;
      },
      next: (page) => {
        return page.next;
      },
    }),
    get: get({
      response: GetPolicyResponse,
      call: async ({ client, projectId }, ref) => {
        const policyService = new PolicyService(client, projectId);
        if (ref.startsWith("pol_")) {
          return policyService.get(ref);
        }
        const notFound = () => {
          return new ZitadelError("E_NOT_FOUND", `No policy for "${ref}"`, {
            hint: `List the project's policies with the policy list command. A policy is addressed by its id or its operation (${POLICY_OPERATIONS.join(", ")}).`,
          });
        };
        const operation = POLICY_OPERATIONS.find((known) => {
          return known === ref;
        });
        if (operation === undefined) {
          throw notFound();
        }
        const current = await policyService.ofOperation(operation);
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
 * `EnvironmentCommand`), so they take `--env` and `--env-file` too. A
 * `${{ NAME }}` reference to a project variable (ADR 062) names a credential
 * without revealing it, and is the only form a connection's `client_secret`
 * takes, so it may stand on a command line.
 */
export const RESOURCE_COMMANDS = buildResourceCommands<Platform>(
  RESOURCES,
  {
    operations: OPERATIONS,
    references: {
      matches: isVariableReference,
      example: "'${{ NAME }}'",
    },
    connect: async (open) => {
      const { client, projectId } = await open();
      return {
        client,
        projectId,
      };
    },
  },
  // Every generated command connects to a server and reports on its own run.
  (Base) => {
    return Telemetered(ServerCommand(Base));
  },
);

/**
 * A generated resource command as a suggestion is checked against it. Its
 * arguments and flags are built from the resource at run time, so the compiler
 * checks only that the command exists; the renderer refuses an argument or a
 * flag the command does not declare.
 */
type ResourceTarget = Readonly<{ args: LooseArgs; flags: Interfaces.FlagInput }>;

/** The ids of a registry entry's commands: `user:list`, `session:revoke`. */
type IdsOf<Topic extends string, Entry> = Entry extends {
  readonly [verbs]?: infer Verb extends string;
}
  ? `${Topic}:${Verb}`
  : never;

/** Every generated resource command a run can suggest, by id (`user:get`). */
export type ResourceTable = {
  readonly [Id in {
    [Topic in keyof typeof RESOURCES & string]: IdsOf<Topic, (typeof RESOURCES)[Topic]>;
  }[keyof typeof RESOURCES & string]]: ResourceTarget;
};
