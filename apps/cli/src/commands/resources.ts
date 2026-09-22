import { createZitadelClient, type ZitadelClient } from "@zitadel/api/client";
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
  GetEnvironmentByNameResponse,
  GetFlowDefinitionResponse,
  CreateIdpBody,
  GetGrantResponse,
  GetProjectResponse,
  GetSessionResponse,
  GetReleaseByIdResponse,
  GetSchemaByIdResponse,
  GetIdpByIdResponse,
  GetTeamResponse,
  GetUserByIDResponse,
  ListBrandingResponse,
  ListEnvironmentsResponse,
  ListEventsResponse,
  ListFlowDefinitionsResponse,
  ListReleasesResponse,
  ListSchemasResponse,
  QueryGrantsResponse,
  QueryIdpsBody,
  QueryIdpsResponse,
  QueryProjectsResponse,
  QuerySessionsResponse,
  QueryTeamsResponse,
  QueryUsersResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type {
  CreateGrantBody as CreateGrantBodyT,
  CreateIdpBody as CreateIdpBodyT,
  CreateTeamBody as CreateTeamBodyT,
  CreateUserBody as CreateUserBodyT,
  ListEnvironmentsParams,
  ListEventsParams,
  ListFlowDefinitionsParams,
  ListReleasesParams,
  ListSchemasParams,
  PatchProjectBody as PatchProjectBodyT,
  PatchUserByIDBody as PatchUserByIDBodyT,
  QueryGrantsBody as QueryGrantsBodyT,
  QueryIdpsBody as QueryIdpsBodyT,
  QueryProjectsBody as QueryProjectsBodyT,
  QuerySessionsBody as QuerySessionsBodyT,
  QueryTeamsBody as QueryTeamsBodyT,
  QueryUsersBody as QueryUsersBodyT,
  UpdateTeamBody as UpdateTeamBodyT,
} from "@zitadel/api/generated/model";
import { consola } from "consola";

import { CommandGroups } from "../lib/oclif/groups";
import { ZitadelError } from "../lib/errors";
import { buildResourceCommands, type ResourceRegistry } from "../lib/oclif/crud";
import { readZitadelSecret } from "../lib/project";

/**
 * The platform connection every resource verb calls through: the typed
 * client bound to the resolved server, plus the project the credential in
 * `.zitadel/secret` belongs to. Endpoints that scope by `project_id` read it
 * from here; the flag surface never exposes it.
 */
export type Platform = Readonly<{ client: ZitadelClient; projectId: string }>;

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

/**
 * The runtime resources the CLI manages imperatively — one entry per topic.
 * Config resources (schemas, flows, branding, releases) are deliberately
 * absent: they reconcile from `.zitadel/**` through `plan` / `apply`
 * (ADR 007, ADR 035), and an imperative write path would fork that source of
 * truth. Adding a backend resource is adding an entry here.
 */
export const RESOURCES = {
  users: {
    group: CommandGroups.resources,
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
    list: {
      items: "users",
      body: QueryUsersBody,
      response: QueryUsersResponse,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "id", operations: FILTER_OPERATIONS },
        { field: "schema", operations: FILTER_OPERATIONS },
        { field: "status", operations: FILTER_OPERATIONS },
        { field: "team_id", operations: FILTER_OPERATIONS },
        { field: "lifecycle_owner_team_id", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "id", "schema", "status", "lifecycle_owner_team_id"],
      // The users query binds to the token's project; no project_id param.
      call: ({ client }, body) => client.queryUsers(body as QueryUsersBodyT),
    },
    get: { call: ({ client }, id) => client.getUserByID(id), response: GetUserByIDResponse },
    create: {
      schema: CreateUserBody,
      call: ({ client, projectId }, body) =>
        client.createUser(body as CreateUserBodyT, { project_id: projectId }),
    },
    update: {
      schema: PatchUserByIDBody,
      call: ({ client }, id, body) => client.patchUserByID(id, body as PatchUserByIDBodyT),
    },
    delete: { call: ({ client }, id) => client.deleteUserByID(id) },
  },

  teams: {
    group: CommandGroups.resources,
    singular: "team",
    idField: "id",
    columns: ["id", "name", "status", "created_at"],
    heading: "name",
    detail: ["id", "status", "created_at", "updated_at"],
    list: {
      items: "teams",
      body: QueryTeamsBody,
      response: QueryTeamsResponse,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "name", operations: FILTER_OPERATIONS },
        { field: "status", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "name", "status"],
      call: ({ client, projectId }, body) =>
        client.queryTeams(body as QueryTeamsBodyT, { project_id: projectId }),
    },
    get: { call: ({ client }, id) => client.getTeam(id), response: GetTeamResponse },
    create: {
      schema: CreateTeamBody,
      call: ({ client, projectId }, body) =>
        client.createTeam(body as CreateTeamBodyT, { project_id: projectId }),
    },
    update: {
      schema: UpdateTeamBody,
      call: ({ client }, id, body) => client.updateTeam(id, body as UpdateTeamBodyT),
    },
    // A team's DELETE deactivates it and leaves it readable (ADR 024), so the
    // command is named after that rather than claiming the team is gone.
    delete: { verb: "deactivate", call: ({ client }, id) => client.deleteTeam(id) },
  },

  sessions: {
    group: CommandGroups.resources,
    singular: "session",
    idField: "session_id",
    columns: ["session_id", "state", "user_id", "created_at", "expires_at"],
    heading: "session_id",
    detail: ["project_id", "state", "user_id", "created_at", "expires_at"],
    list: {
      items: "sessions",
      body: QuerySessionsBody,
      response: QuerySessionsResponse,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "user_id", operations: FILTER_OPERATIONS },
        { field: "state", operations: FILTER_OPERATIONS },
        { field: "lifecycle_owner_team_id", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "user_id"],
      call: ({ client, projectId }, body) =>
        client.querySessions(body as QuerySessionsBodyT, { project_id: projectId }),
    },
    get: { call: ({ client }, id) => client.getSession(id), response: GetSessionResponse },
    // The endpoint terminates the session rather than removing a record, so
    // the command says `revoke`. `delete` would tell the caller it is gone.
    delete: { verb: "revoke", call: ({ client }, id) => client.revokeSession(id) },
  },

  events: {
    group: CommandGroups.resources,
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
    list: {
      items: "data",
      response: ListEventsResponse,
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
        client.listEvents({ project_id: projectId, ...params } as ListEventsParams),
    },
    get: { call: ({ client, projectId }, id) => client.getEvent(id, { project_id: projectId }) },
  },

  grants: {
    group: CommandGroups.resources,
    singular: "grant",
    idField: "id",
    columns: ["id", "user.user_id", "team.team_id", "relation", "created_at", "expires_at"],
    heading: "id",
    detail: [
      "user.user_id",
      "team.team_id",
      "relation",
      "object_type",
      "created_at",
      "expires_at",
    ],
    list: {
      items: "grants",
      body: QueryGrantsBody,
      response: QueryGrantsResponse,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
        { field: "user_id", operations: FILTER_OPERATIONS },
        { field: "team_id", operations: FILTER_OPERATIONS },
        { field: "relation", operations: FILTER_OPERATIONS },
        { field: "expires_at", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at", "expires_at", "id"],
      call: ({ client, projectId }, body) =>
        client.queryGrants(body as QueryGrantsBodyT, { project_id: projectId }),
    },
    get: {
      call: ({ client, projectId }, id) => client.getGrant(id, { project_id: projectId }),
      response: GetGrantResponse,
    },
    create: {
      schema: CreateGrantBody,
      call: ({ client, projectId }, body) =>
        client.createGrant(body as CreateGrantBodyT, { project_id: projectId }),
    },
    delete: {
      call: ({ client, projectId }, id) => client.deleteGrant(id, { project_id: projectId }),
    },
  },

  // Identity provider connections (#1217). They carry ADR 063's shape already:
  // a fixed `id` shared by every revision, and a `revision_id` per revision.
  // The revision routes are not modelled here — the CLI has no grammar for a
  // sub-resource listing yet, so `idps revisions` is deliberately absent.
  idps: {
    group: CommandGroups.resources,
    singular: "identity provider connection",
    idField: "id",
    columns: ["id", "slug", "definition.protocol", "definition.display_name", "created_at"],
    heading: "slug",
    detail: ["id", "revision_id", "slug", "created_at", "updated_at"],
    list: {
      items: "idps",
      body: QueryIdpsBody,
      response: QueryIdpsResponse,
      filters: [
        { field: "slug", operations: FILTER_OPERATIONS },
        { field: "created_at", operations: FILTER_OPERATIONS },
      ],
      sorts: ["slug", "created_at"],
      call: ({ client, projectId }, body) =>
        client.queryIdps(body as QueryIdpsBodyT, { project_id: projectId }),
    },
    get: {
      call: ({ client, projectId }, id) => client.getIdpById(id, { project_id: projectId }),
      response: GetIdpByIdResponse,
    },
    create: {
      // The body nests everything under `idp`, so there are no field flags to
      // generate; `--data` and `--file` carry it.
      schema: CreateIdpBody,
      call: ({ client, projectId }, body) =>
        client.createIdp(body as CreateIdpBodyT, { project_id: projectId }),
    },
  },

  projects: {
    group: CommandGroups.resources,
    singular: "project",
    idField: "id",
    columns: ["id", "name", "created_at"],
    heading: "name",
    detail: ["id", "preview_origins", "created_at", "updated_at"],
    list: {
      items: "projects",
      body: QueryProjectsBody,
      response: QueryProjectsResponse,
      filters: [
        { field: "created_at", operations: FILTER_OPERATIONS },
      ],
      sorts: ["created_at"],
      call: ({ client }, body) => client.queryProjects(body as QueryProjectsBodyT),
    },
    get: { call: ({ client }, id) => client.getProject(id), response: GetProjectResponse },
    update: {
      schema: PatchProjectBody,
      call: ({ client }, id, body) => client.patchProject(id, body as PatchProjectBodyT),
    },
  },

  // Configuration resources (ADR 035) are read-only here. They are authored as
  // files under `.zitadel/` and shipped through a release, so a write verb
  // would be a second writer over the same state; reading what the server
  // currently holds is how you check that a deploy landed.
  schemas: {
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
    list: {
      items: "schemas",
      response: ListSchemasResponse,
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
        client.listSchemas({ ...params, project_id: projectId } as ListSchemasParams),
    },
    get: {
      response: GetSchemaByIdResponse,
      // A schema is addressed two ways. `sch_…`, or the customer's own `$id`
      // URI, names one immutable revision and fetches directly. Anything else
      // is an object type, which the endpoint resolves to the current revision
      // in a single call. The API has no fetch-by-object-type route yet; when
      // it does, this collapses to one client call like every other `get`.
      call: async ({ client, projectId }, ref) => {
        if (ref.startsWith("sch_") || ref.includes("://")) {
          return client.getSchemaById(ref);
        }
        const page = await client.listSchemas({
          project_id: projectId,
          object_type: ref,
          revisions: "latest",
          limit: 1,
        } as ListSchemasParams);
        const current = page.schemas[0];
        if (!current) {
          throw new ZitadelError("E_NOT_FOUND", `No schema for object type "${ref}"`, {
            hint: "Run `schemas list` to see the object types this project has.",
          });
        }
        return current;
      },
    },
  },

  environments: {
    group: CommandGroups.configuration,
    singular: "environment",
    idField: "id",
    // Addressed by its public handle: `GET /environments/{name}`, and the name
    // is what a deploy target is called everywhere else in the CLI.
    idArg: "name",
    columns: ["name", "id", "created_at"],
    heading: "name",
    detail: ["name", "id", "project_id", "created_at"],
    list: {
      items: "environments",
      response: ListEnvironmentsResponse,
      call: ({ client, projectId }, params) =>
        client.listEnvironments({ ...params, project_id: projectId } as ListEnvironmentsParams),
    },
    get: {
      call: ({ client, projectId }, name) =>
        client.getEnvironmentByName(name, { project_id: projectId }),
      response: GetEnvironmentByNameResponse,
    },
  },

  releases: {
    group: CommandGroups.configuration,
    singular: "release",
    idField: "id",
    columns: ["id", "metadata.message", "metadata.git_sha"],
    heading: "id",
    detail: ["id", "project_id", "metadata.message", "metadata.git_sha", "metadata.git_dirty"],
    list: {
      items: "releases",
      response: ListReleasesResponse,
      call: ({ client, projectId }, params) =>
        client.listReleases({ ...params, project_id: projectId } as ListReleasesParams),
    },
    get: {
      call: ({ client, projectId }, id) => client.getReleaseById(id, { project_id: projectId }),
      response: GetReleaseByIdResponse,
    },
  },

  "flow-definitions": {
    group: CommandGroups.configuration,
    singular: "flow definition",
    idField: "id",
    // Addressed by flow name as well as by revision id; see `schemas`.
    idArg: "flow",
    idDescription: "flow name (newest revision) or revision id",
    columns: ["id", "flow_definition.name", "flow_definition.status", "created_at"],
    heading: "flow_definition.name",
    detail: ["id", "flow_definition.name", "flow_definition.status", "created_at", "updated_at"],
    list: {
      items: "flow_definitions",
      response: ListFlowDefinitionsResponse,
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
        } as ListFlowDefinitionsParams),
    },
    get: {
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
        } as ListFlowDefinitionsParams);
        const current = page.flow_definitions[0];
        if (!current) {
          throw new ZitadelError("E_NOT_FOUND", `No flow definition named "${ref}"`, {
            hint: "Run `flow-definitions list` to see the flows this project has.",
          });
        }
        return current;
      },
    },
  },

  branding: {
    group: CommandGroups.configuration,
    singular: "branding revision",
    idField: "id",
    columns: ["id", "created_at"],
    heading: "id",
    detail: ["id", "created_at"],
    list: {
      // `GET /branding` answers with the array itself and takes no cursor, so
      // the paging flags are not generated for it.
      paged: false,
      response: ListBrandingResponse,
      call: ({ client, projectId }) => client.listBranding({ project_id: projectId }),
    },
    get: {
      call: ({ client }, id) => client.getBrandingById(id),
      response: GetBrandingByIdResponse,
    },
  },
} satisfies ResourceRegistry<Platform>;

/**
 * The `<resource> <verb>` commands, ready for the explicit command table.
 * Connecting mirrors `schemas list` and `apply`: the project secret from
 * `.zitadel/secret` becomes the bearer, so a missing secret fails the same
 * way (`E_VALIDATION` pointing at `zitadel setup`).
 */
export const RESOURCE_COMMANDS = buildResourceCommands<Platform>(RESOURCES, {
  operations: FILTER_OPERATIONS,
  connect: async ({ cwd, source }) => {
    const secret = await readZitadelSecret(cwd);
    // Which project and server a verb is about is worth stating to a human, and
    // is the "make boundary-crossing visible" rule from the CLI guidelines. It
    // shares stdout with the result, though, so a piped run would feed those
    // lines to whatever consumes the output — a piped `users list` would have
    // them counted as rows by `wc -l`. On a pipe the result travels alone;
    // `--json` silences them either way.
    if (process.stdout.isTTY) {
      consola.info(`Project   ${secret.project_id}`);
      consola.info(`Server    ${source}`);
    }
    return {
      client: createZitadelClient({ baseUrl: source, token: secret.project_secret }),
      projectId: secret.project_id,
    };
  },
});
