/**
 * Design-review fixture fallback for the dev server.
 *
 * **Dev-only, opt-in.** `main.tsx` loads this module only when
 * `import.meta.env.DEV && import.meta.env.VITE_CONSOLE_FIXTURES`; in a
 * production build that condition is the literal `false`, so the import and
 * this whole folder are dropped from the bundle.
 *
 * It wraps `window.fetch` for the console's own API base. Every request still
 * goes to the real backend first; only an *unusable* answer is replaced:
 *
 *   - a network failure or a status of 400 and above, or
 *   - a successful list that came back empty.
 *
 * The replacement is the Figma data in `data.ts`, served by the small route
 * table below and kept in an in-memory store, so creating, renaming and
 * deleting records works for the length of a page load. Routing, project
 * scoping, loaders and the generated API client are all untouched — the screens
 * cannot tell a fixture response from a real one.
 *
 * Not covered on purpose: the session and runtime discovery (the auth guard and
 * the runtime must stay real), and anything the route table does not name.
 */

import { apiBase } from "@/api/zitadel";

import {
  BRANDING,
  FLOW_DEFINITIONS,
  GRANTS,
  PASSKEYS,
  PROJECTS,
  SCHEMAS,
  TEAMS,
  USERS,
} from "./data";

type Json = Record<string, unknown>;

interface FixtureRequest {
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
}

interface FixtureRoute {
  method: string;
  pattern: RegExp;
  /** The response key that holds the list, for routes that return one. */
  collection?: string;
  handle: (request: FixtureRequest) => Response;
}

const store = {
  projects: structuredClone(PROJECTS),
  teams: structuredClone(TEAMS),
  users: structuredClone(USERS),
  schemas: structuredClone(SCHEMAS),
  grants: structuredClone(GRANTS),
  flows: structuredClone(FLOW_DEFINITIONS),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function notFound(): Response {
  return json({ code: "not_found", message: "resource not found (fixture)" }, 404);
}

function byId(list: Json[], id: string | undefined): Json | undefined {
  return list.find((entry) => entry.id === id);
}

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The `filter` array `POST /teams/query` sends: `equals` and `contains` on string fields. */
function matchesFilter(record: Json, filter: unknown): boolean {
  if (!Array.isArray(filter)) return true;
  return filter.every((clause) => {
    if (!clause || typeof clause !== "object") return true;
    const { field, operation, value } = clause as Json;
    const actual = String(record[field as string] ?? "").toLowerCase();
    const expected = String(value ?? "").toLowerCase();
    if (operation === "equals") return actual === expected;
    if (operation === "contains") return actual.includes(expected);
    return true;
  });
}

function withoutTeams(user: Json): Json {
  const { teams: _teams, ...rest } = user;
  return rest;
}

const ROUTES: FixtureRoute[] = [
  // Projects
  {
    method: "GET",
    pattern: /^\/users\/me\/projects$/,
    collection: "projects",
    handle: () => json({ projects: store.projects }),
  },
  {
    method: "GET",
    pattern: /^\/projects\/(?<id>[^/]+)$/,
    handle: ({ params }) => {
      const record = byId(store.projects, params.id);
      return record ? json(record) : notFound();
    },
  },
  {
    method: "PATCH",
    pattern: /^\/projects\/(?<id>[^/]+)$/,
    handle: ({ params, body }) => {
      const record = byId(store.projects, params.id);
      if (!record) return notFound();
      Object.assign(record, body, { updated_at: now() });
      return json(record);
    },
  },

  // Teams
  {
    method: "POST",
    pattern: /^\/teams\/query$/,
    collection: "teams",
    handle: ({ body }) =>
      json({ teams: store.teams.filter((team) => matchesFilter(team, body.filter)) }),
  },
  {
    method: "POST",
    pattern: /^\/teams$/,
    handle: ({ body }) => {
      const record = {
        id: newId("team"),
        status: "active",
        created_at: now(),
        updated_at: now(),
        ...body,
      };
      store.teams.unshift(record);
      return json(record, 201);
    },
  },
  {
    method: "GET",
    pattern: /^\/teams\/(?<id>[^/]+)$/,
    handle: ({ params }) => {
      const record = byId(store.teams, params.id);
      return record ? json(record) : notFound();
    },
  },
  {
    method: "PATCH",
    pattern: /^\/teams\/(?<id>[^/]+)$/,
    handle: ({ params, body }) => {
      const record = byId(store.teams, params.id);
      if (!record) return notFound();
      Object.assign(record, body, { updated_at: now() });
      return json(record);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/teams\/(?<id>[^/]+)$/,
    handle: ({ params }) => {
      store.teams = store.teams.filter((team) => team.id !== params.id);
      return noContent();
    },
  },

  // Users
  {
    method: "POST",
    pattern: /^\/users\/query$/,
    collection: "users",
    handle: ({ body }) => {
      // One page holds every fixture user, so a follow-up page is empty.
      if (body.page_token) return json({ users: [] });
      const expandTeams = Array.isArray(body.expand) && body.expand.includes("teams");
      return json({ users: expandTeams ? store.users : store.users.map(withoutTeams) });
    },
  },
  {
    method: "POST",
    pattern: /^\/users$/,
    handle: ({ body, query }) => {
      const attributes = (body.attributes ?? {}) as Json;
      const email = typeof attributes.email === "string" ? attributes.email : undefined;
      const record = {
        id: newId("user"),
        schema: body.schema ?? query.get("schema") ?? "sch_minimal",
        ...(email ? { identifier: email, identifier_property: "email" } : {}),
        attributes,
        metadata: { status: "active", created_at: now(), updated_at: now() },
        teams: [],
      };
      store.users.unshift(record);
      return json(record, 201);
    },
  },
  {
    method: "GET",
    pattern: /^\/users\/(?<id>[^/]+)\/passkeys$/,
    collection: "passkeys",
    handle: ({ params }) =>
      byId(store.users, params.id) ? json({ passkeys: PASSKEYS }) : notFound(),
  },
  {
    method: "GET",
    pattern: /^\/users\/(?<id>(?!me$)[^/]+)$/,
    handle: ({ params }) => {
      const record = byId(store.users, params.id);
      return record ? json(withoutTeams(record)) : notFound();
    },
  },
  {
    method: "DELETE",
    pattern: /^\/users\/(?<id>(?!me$)[^/]+)$/,
    handle: ({ params }) => {
      store.users = store.users.filter((entry) => entry.id !== params.id);
      store.grants = store.grants.filter(
        (grant) => (grant.user as Json | undefined)?.user_id !== params.id,
      );
      return noContent();
    },
  },

  // User schemas
  {
    method: "GET",
    pattern: /^\/schemas$/,
    collection: "schemas",
    handle: () => json({ schemas: store.schemas }),
  },
  {
    method: "GET",
    pattern: /^\/schemas\/(?<id>[^/]+)$/,
    handle: ({ params }) => {
      const record = byId(store.schemas, params.id);
      return record ? json(record) : notFound();
    },
  },

  // Login flows
  {
    method: "GET",
    pattern: /^\/flow_definitions$/,
    collection: "flow_definitions",
    handle: ({ query }) => {
      const expand = query.getAll("expand").join(",");
      return json({
        flow_definitions: store.flows.map((entry) => {
          if (!expand.includes("user_schema")) return entry;
          const schemaId = (entry.flow_definition as Json).user_schema as string;
          return { ...entry, user_schema: byId(store.schemas, schemaId) };
        }),
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/flow_definitions\/(?<id>[^/]+)$/,
    handle: ({ params }) => {
      const record = byId(store.flows, params.id);
      return record ? json(record) : notFound();
    },
  },

  // Branding (the list is a bare array, not an envelope)
  {
    method: "GET",
    pattern: /^\/branding$/,
    collection: "",
    handle: () => json([{ id: BRANDING.id, created_at: BRANDING.created_at }]),
  },
  {
    method: "GET",
    pattern: /^\/branding\/(?<id>[^/]+)$/,
    handle: ({ params }) => (params.id === BRANDING.id ? json(BRANDING) : notFound()),
  },

  // Project settings › Admins
  {
    method: "POST",
    pattern: /^\/grants\/query$/,
    collection: "grants",
    handle: () => json({ grants: store.grants }),
  },
  {
    method: "POST",
    pattern: /^\/grants$/,
    handle: ({ body, query }) => {
      const principal = (body.user ?? {}) as Json;
      const person = byId(store.users, principal.user_id as string);
      const record = {
        id: newId("asgn"),
        project_id: query.get("project_id"),
        object_type: "project",
        relation: body.relation ?? "admin",
        created_at: now(),
        user: { ...(person ? withoutTeams(person) : {}), ...principal, id: undefined },
      };
      store.grants.push(record);
      return json(record, 201);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/grants\/(?<id>[^/]+)$/,
    handle: ({ params }) => {
      store.grants = store.grants.filter((grant) => grant.id !== params.id);
      return noContent();
    },
  },
];

/** The path under the API base, or `undefined` for a request the console did not aim at it. */
function apiPath(url: URL): string | undefined {
  const base = new URL(apiBase || "/", window.location.origin);
  if (url.origin !== base.origin) return undefined;
  const prefix = base.pathname.replace(/\/$/, "");
  if (prefix && !url.pathname.startsWith(`${prefix}/`)) return undefined;
  return url.pathname.slice(prefix.length);
}

function findRoute(method: string, path: string) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) return { route, params: { ...match.groups } as Record<string, string> };
  }
  return undefined;
}

/** A real answer the screen can render: a success, and not an empty list. */
async function isUsable(response: Response, collection: string | undefined): Promise<boolean> {
  if (!response.ok) return false;
  if (collection === undefined) return true;
  try {
    const body = (await response.clone().json()) as unknown;
    const list = collection === "" ? body : (body as Json | null)?.[collection];
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<Json> {
  const text = await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

export function installFixtureFallback(): void {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.origin);
    const path = apiPath(url);
    const found = path === undefined ? undefined : findRoute(request.method, path);
    if (!found) return realFetch(request);

    const body = await readBody(request.clone());
    let real: Response | undefined;
    try {
      real = await realFetch(request);
      if (await isUsable(real, found.route.collection)) return real;
    } catch {
      real = undefined;
    }

    console.debug(
      `[fixtures] ${request.method} ${path} → Figma fixture (backend: ${real ? real.status : "unreachable"})`,
    );
    return found.route.handle({
      method: request.method,
      params: found.params,
      query: url.searchParams,
      body,
    });
  };

  console.info(
    "[fixtures] Design-review fixtures active: unusable API answers fall back to Figma data.",
  );
}
