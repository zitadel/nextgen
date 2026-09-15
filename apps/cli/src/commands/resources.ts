import { Flags } from "@oclif/core";
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
  GetGrantResponse,
  GetProjectResponse,
  GetSessionResponse,
  GetReleaseByIdResponse,
  GetSchemaByIdResponse,
  GetTeamResponse,
  GetUserByIDResponse,
  ListBrandingResponse,
  ListEnvironmentsResponse,
  ListEventsResponse,
  ListFlowDefinitionsResponse,
  ListReleasesResponse,
  ListSchemasResponse,
  QueryGrantsResponse,
  QueryProjectsResponse,
  QuerySessionsResponse,
  QueryTeamsResponse,
  QueryUsersResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type {
  CreateGrantBody as CreateGrantBodyT,
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
  QueryProjectsBody as QueryProjectsBodyT,
  QuerySessionsBody as QuerySessionsBodyT,
  QueryTeamsBody as QueryTeamsBodyT,
  QueryUsersBody as QueryUsersBodyT,
  UpdateTeamBody as UpdateTeamBodyT,
} from "@zitadel/api/generated/model";
import { consola } from "consola";

import { environmentSchema } from "../lib/environment";
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
    // command reports that rather than claiming the team is gone.
    delete: { outcome: "deactivated", call: ({ client }, id) => client.deleteTeam(id) },
  },

  sessions: {
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
    // The endpoint revokes rather than removes, so the result says so; the
    // verb stays `delete`, because a resource is removed the same way
    // everywhere and what the server did is a property of the answer.
    delete: { outcome: "revoked", call: ({ client }, id) => client.revokeSession(id) },
  },

  events: {
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
    singular: "grant",
    idField: "id",
    columns: ["id", "principal_type", "principal_id", "relation", "created_at", "expires_at"],
    heading: "id",
    detail: [
      "principal_type",
      "principal_id",
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
        { field: "principal_type", operations: FILTER_OPERATIONS },
        { field: "principal_id", operations: FILTER_OPERATIONS },
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

  projects: {
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
    singular: "schema",
    idField: "id",
    columns: ["id", "schema.objectType", "schema.kind", "metadata.created_at"],
    heading: "schema.objectType",
    detail: ["id", "schema.objectType", "schema.kind", "metadata.created_at"],
    list: {
      items: "schemas",
      // A schema list is a revision history, and a history truncated at one
      // page reads as a complete one. Draining keeps `schemas list` answering
      // the question it is asked (#947).
      drains: true,
      response: ListSchemasResponse,
      filters: [
        { field: "object_type", operations: ["equals"] },
        { field: "kind", operations: ["equals"] },
        { field: "revisions", operations: ["equals"], values: ["all", "latest"] },
      ],
      call: ({ client, projectId }, params) =>
        client.listSchemas({ ...params, project_id: projectId } as ListSchemasParams),
    },
    get: {
      call: ({ client }, id) => client.getSchemaById(id),
      response: GetSchemaByIdResponse,
    },
  },

  environments: {
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
    singular: "flow definition",
    idField: "id",
    columns: ["id", "flow_definition.name", "flow_definition.status", "created_at"],
    heading: "flow_definition.name",
    detail: ["id", "flow_definition.name", "flow_definition.status", "created_at", "updated_at"],
    list: {
      items: "flow_definitions",
      response: ListFlowDefinitionsResponse,
      filters: [
        { field: "name", operations: ["equals"] },
        { field: "purpose", operations: ["equals"] },
      ],
      call: ({ client, projectId }, params) =>
        client.listFlowDefinitions({
          ...params,
          project_id: projectId,
        } as ListFlowDefinitionsParams),
    },
    get: {
      call: ({ client }, id) => client.getFlowDefinition(id),
      response: GetFlowDefinitionResponse,
    },
  },

  branding: {
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
  flags: {
    environment: Flags.string({
      char: "e",
      description: "Target environment (default: development).",
      options: [...environmentSchema.options],
    }),
  },
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
