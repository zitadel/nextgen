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
  GetGrantResponse,
  GetProjectResponse,
  GetSessionResponse,
  GetTeamResponse,
  GetUserByIDResponse,
  ListEventsResponse,
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
  ListEventsParams,
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
type Platform = Readonly<{ client: ZitadelClient; projectId: string }>;

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
      kind: "query",
      items: "users",
      body: QueryUsersBody,
      response: QueryUsersResponse,
      filterFields: ["created_at", "id", "schema", "status", "team_id", "lifecycle_owner_team_id"],
      sortFields: ["created_at", "id", "schema", "status", "lifecycle_owner_team_id"],
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
      kind: "query",
      items: "teams",
      body: QueryTeamsBody,
      response: QueryTeamsResponse,
      filterFields: ["created_at", "name", "status"],
      sortFields: ["created_at", "name", "status"],
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
      kind: "query",
      items: "sessions",
      body: QuerySessionsBody,
      response: QuerySessionsResponse,
      filterFields: ["created_at", "user_id", "state", "lifecycle_owner_team_id"],
      sortFields: ["created_at", "user_id"],
      call: ({ client, projectId }, body) =>
        client.querySessions(body as QuerySessionsBodyT, { project_id: projectId }),
    },
    get: { call: ({ client }, id) => client.getSession(id), response: GetSessionResponse },
    delete: { verb: "revoke", call: ({ client }, id) => client.revokeSession(id) },
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
      kind: "params",
      items: "data",
      response: ListEventsResponse,
      params: [
        {
          flag: "category",
          param: "category",
          description: "Wide-event category (repeatable, OR within the flag).",
          multiple: true,
          options: EVENT_CATEGORIES,
        },
        {
          flag: "event-type",
          param: "event_type",
          description: "Exact event_type match (repeatable, OR within the flag).",
          multiple: true,
        },
        { flag: "actor-id", param: "actor_id", description: "Filter by the acting principal." },
        { flag: "session-id", param: "session_id", description: "Filter by session id." },
        { flag: "flow-id", param: "flow_id", description: "Filter by login flow id." },
        { flag: "request-id", param: "request_id", description: "Filter by request id." },
        { flag: "entity-type", param: "entity_type", description: "Filter by entity type." },
        { flag: "entity-id", param: "entity_id", description: "Filter by entity id." },
        { flag: "team-id", param: "team_id", description: "Filter by emit-time team scope." },
        {
          flag: "created-after",
          param: "created_after",
          description: "Inclusive lower bound on created_at (RFC 3339).",
        },
        {
          flag: "created-before",
          param: "created_before",
          description: "Exclusive upper bound on created_at (RFC 3339).",
        },
        {
          flag: "order",
          param: "order",
          description: "Sort direction on created_at (default: desc).",
          options: ["asc", "desc"],
        },
      ],
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
      kind: "query",
      items: "grants",
      body: QueryGrantsBody,
      response: QueryGrantsResponse,
      filterFields: ["created_at", "principal_type", "principal_id", "relation", "expires_at"],
      sortFields: ["created_at", "expires_at", "id"],
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
      kind: "query",
      items: "projects",
      body: QueryProjectsBody,
      response: QueryProjectsResponse,
      filterFields: ["created_at"],
      sortFields: ["created_at"],
      call: ({ client }, body) => client.queryProjects(body as QueryProjectsBodyT),
    },
    get: { call: ({ client }, id) => client.getProject(id), response: GetProjectResponse },
    update: {
      schema: PatchProjectBody,
      call: ({ client }, id, body) => client.patchProject(id, body as PatchProjectBodyT),
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
