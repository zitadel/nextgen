/**
 * Spec-conformance test for the api-mock.
 *
 * This test is independent of the hand-written response shapes in
 * `server.ts` / `platform-handlers.ts`. It boots the real Express mock
 * server, POSTs / GETs every mocked endpoint, and validates the response
 * against the corresponding **zod** schema orval generates from the OAS.
 *
 * The TypeScript types from `@zitadel/api/generated/model` give
 * compile-time guarantees about shape; zod validation gives **runtime**
 * guarantees about regex patterns, enum values, min/max constraints, and
 * required-vs-optional. Together they're the "golden" guarantee: if this
 * test passes, the mock's wire output is provably spec-compliant.
 *
 * Endpoints covered by zod here:
 *   - POST /sessions/exchange           → ExchangeHandoffResponse
 *   - GET  /projects/:id                → GetProjectResponse
 *   - GET  /flow_definitions            → ListFlowDefinitionsResponse
 *   - GET  /flow_definitions/:id        → GetFlowDefinitionResponse
 *
 * Endpoints covered structurally (orval emits no `*Response` zod for these
 * because they have no static response schema — POSTs that return only an
 * `id`, or out-of-spec routes):
 *   - POST /schemas                     → { id }
 *   - POST /flow_definitions            → flow-definition-response envelope
 *
 * Also covered by zod here:
 *   - POST /projects                    → CreateProjectResponse
 *   - POST /projects/:id/origins        → AddOriginResponse
 *
 * `GET /schemas/:id` is NOT zod-validated here: the mock stores whatever
 * the user POSTed verbatim, so the response shape depends on the request
 * the caller made. The structural test below just exercises the 404 path
 * (clear contract: spec-compliant error envelope).
 */
import type { Server } from "node:http";

import {
  AddOriginResponse,
  CompleteClaimResponse,
  CreateIdpResponse,
  CreateProjectResponse,
  ExchangeHandoffResponse,
  GetClaimStatusResponse,
  GetFlowDefinitionResponse,
  GetIdpByIdResponse,
  GetMySessionResponse,
  GetProjectResponse,
  GetVariablesResponse,
  ListFlowDefinitionsResponse,
  QueryIdpsResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { signHandoffToken } from "./crypto.js";
import {
  expireClaimChallenge,
  expireClaimWindow,
  snapshotPlatformStore,
} from "./platform-handlers.js";
import { PLATFORM_PROJECT_ID, csrfTokenFor, startMockServer } from "./server.js";

const PORT = 4456;
const BASE = `http://localhost:${PORT}`;
let server: Server;

beforeAll(async () => {
  server = startMockServer(PORT);
  await new Promise<void>((resolve) => {
    if (server.listening) {
      resolve();
    } else {
      server.once("listening", () => resolve());
    }
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

/**
 * Helper: a valid flow-definition body that satisfies the spec's
 * `flow-definition.yaml` required fields. Used by the flow_definitions
 * tests so the response (which inlines this body) passes zod validation.
 */
function validFlowDefinitionBody(): Record<string, unknown> {
  return {
    name: "login-flow",
    status: "active",
    user_schema:
      "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.yaml",
    // Per `flow-definition.yaml`, `purposes` is an object mapping each
    // purpose name to its entry-point step (must match a `name` in `steps`).
    // The shape must satisfy the definition-time validator the mock now
    // mirrors: every action wires a transition, every non-terminal step can
    // reach a terminal step.
    purposes: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", text_key: "submit", primary: true }],
        transitions: { submit: { target: "done" } },
      },
      { name: "done", complete: "show" },
    ],
  };
}

describe("api-mock spec conformance — responses match orval-generated zod", () => {
  test("POST /sessions/exchange returns body parseable by ExchangeHandoffResponse", async () => {
    const handoff = await signHandoffToken({ sub: "proj_test", iss: BASE });
    const res = await fetch(`${BASE}/sessions/exchange?project_id=proj_test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => ExchangeHandoffResponse.parse(body)).not.toThrow();
  });

  test("GET /sessions/me resolves a display for the known demo identities", async () => {
    const handoff = await signHandoffToken({ sub: "ada@example.com", iss: BASE });
    const exchange = await fetch(`${BASE}/sessions/exchange?project_id=proj_me_display`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("__nextgen_session="))
      ?.split(";")[0];

    const res = await fetch(`${BASE}/sessions/me`, { headers: { cookie: cookie ?? "" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(() => GetMySessionResponse.parse(body)).not.toThrow();
    expect(body.user).toMatchObject({
      identifier: "ada@example.com",
      identifier_property: "email",
      display: "Ada Lovelace",
    });
  });

  // Mirrors the server: a read that names a project refuses a session of any
  // other project, and serves its own as before.
  test("GET /sessions/me with project_id refuses a session of another project", async () => {
    const handoff = await signHandoffToken({ sub: "app-user@example.com", iss: BASE });
    const exchange = await fetch(`${BASE}/sessions/exchange?project_id=proj_me_app`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("__nextgen_session="))
      ?.split(";")[0];

    const refused = await fetch(`${BASE}/sessions/me?project_id=proj_me_other`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "sess.project_mismatch" });

    const served = await fetch(`${BASE}/sessions/me?project_id=proj_me_app`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(served.status).toBe(200);
    expect(await served.json()).toMatchObject({ project_id: "proj_me_app" });

    // Like the server, a project_id outside the project-id pattern is a bad
    // request, not a verdict on the session.
    for (const invalid of ["", "proj%20me"]) {
      const rejected = await fetch(`${BASE}/sessions/me?project_id=${invalid}`, {
        headers: { cookie: cookie ?? "" },
      });
      expect(rejected.status).toBe(400);
    }
  });

  test("GET /sessions/me returns body parseable by GetMySessionResponse with a user ref", async () => {
    const handoff = await signHandoffToken({ sub: "me@example.com", iss: BASE });
    const exchange = await fetch(`${BASE}/sessions/exchange?project_id=proj_me`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("__nextgen_session="))
      ?.split(";")[0];
    expect(cookie).toBeDefined();

    const res = await fetch(`${BASE}/sessions/me`, { headers: { cookie: cookie ?? "" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(() => GetMySessionResponse.parse(body)).not.toThrow();
    // The identity contract (ADR 058): the ref carries the sign-in email as
    // the designated identifier; the mock, like the shipped default schema,
    // designates no display properties.
    expect(body.user).toMatchObject({
      user_id: body.user_id,
      identifier: "me@example.com",
      identifier_property: "email",
    });
    expect(body.user).not.toHaveProperty("display");
  });

  test("POST /sessions/exchange without project_id returns 400", async () => {
    const handoff = await signHandoffToken({ sub: "proj_test", iss: BASE });
    const res = await fetch(`${BASE}/sessions/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("sess.project_id_missing");
  });

  // The server cannot tell a replayed token from one it never issued (it
  // deletes the attempt on exchange), so it refuses both, and an expired one,
  // with the same 400 (internal/api/integration_test/session_exchange_test.go).
  describe("POST /sessions/exchange refuses a handoff token it will not exchange", () => {
    const exchange = (handoffToken: string) =>
      fetch(`${BASE}/sessions/exchange?project_id=proj_refused`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoff_token: handoffToken }),
      });
    const expectRefused = async (res: Response) => {
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.code).toBe("sess.invalid_handoff_token");
    };

    test("a replay of an exchanged token", async () => {
      const handoff = await signHandoffToken({ sub: "proj_refused", iss: BASE });
      expect((await exchange(handoff)).status).toBe(200);
      await expectRefused(await exchange(handoff));
    });

    test("a token it never issued", async () => {
      await expectRefused(await exchange("handoff_never_issued"));
    });

    test("an expired token", async () => {
      // Signed two minutes ago, so its 60-second lifetime is over.
      vi.useFakeTimers({ toFake: ["Date"] });
      let handoff: string;
      try {
        vi.setSystemTime(Date.now() - 120_000);
        handoff = await signHandoffToken({ sub: "proj_refused", iss: BASE });
      } finally {
        vi.useRealTimers();
      }
      await expectRefused(await exchange(handoff));
    });
  });

  test("DELETE /sessions/me revokes an active session and clears the cookie", async () => {
    const handoff = await signHandoffToken({ sub: "proj_revoke", iss: BASE });
    const exchange = await fetch(`${BASE}/sessions/exchange?project_id=proj_revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    const setCookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("__nextgen_session="));
    expect(setCookie).toBeDefined();
    const sessionCookie = setCookie?.split(";")[0] ?? "";

    // Session is reachable before revocation.
    const before = await fetch(`${BASE}/sessions/me`, { headers: { cookie: sessionCookie } });
    expect(before.status).toBe(200);

    const revoke = await fetch(`${BASE}/sessions/me`, {
      method: "DELETE",
      headers: { cookie: sessionCookie },
    });
    expect(revoke.status).toBe(204);
    expect(revoke.headers.getSetCookie().some((c) => /^__nextgen_session=;/.test(c))).toBe(true);

    // Session is gone after revocation.
    const after = await fetch(`${BASE}/sessions/me`, { headers: { cookie: sessionCookie } });
    expect(after.status).toBe(401);
  });

  test("derives the CSRF token exactly as the Go server does", () => {
    // Pinned on both sides (internal/api/csrf_internal_test.go TestCSRFTokenVector).
    expect(csrfTokenFor("parity-cookie")).toBe("Rstk677ADwP3NGbLdczBjYCLA5EIxtRtrm-oX7QcYh8");
  });

  test("GET /sessions/me/csrf without a session answers a 401 that is not stored", async () => {
    const res = await fetch(`${BASE}/sessions/me/csrf`);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a cross-origin preflight allows the X-Zitadel-CSRF header", async () => {
    const res = await fetch(`${BASE}/users?project_id=proj_test`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:4200",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, x-zitadel-csrf",
      },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowed).toContain("x-zitadel-csrf");
  });

  describe("/sessions/me without a live session answers 401 auth.unauthorized, as the Go server does", () => {
    /** A fresh session's cookie (`name=value`), minted by a handoff exchange. */
    const newSessionCookie = async (projectId: string): Promise<string> => {
      const handoff = await signHandoffToken({ sub: projectId, iss: BASE });
      const exchange = await fetch(`${BASE}/sessions/exchange?project_id=${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoff_token: handoff }),
      });
      const setCookie = exchange.headers
        .getSetCookie()
        .find((c) => c.startsWith("__nextgen_session="));
      return setCookie?.split(";")[0] ?? "";
    };

    const cookies: readonly (readonly [string, () => Promise<string | undefined>])[] = [
      ["no cookie", async () => undefined],
      ["a cookie it never issued", async () => "__nextgen_session=deadbeefdeadbeef"],
      [
        "a revoked session's cookie",
        async () => {
          const cookie = await newSessionCookie("proj_gone");
          await fetch(`${BASE}/sessions/me`, { method: "DELETE", headers: { cookie } });
          return cookie;
        },
      ],
      [
        "an expired session's cookie",
        async () => {
          // Minted two hours ago, so its one-hour lifetime is over.
          vi.useFakeTimers({ toFake: ["Date"] });
          try {
            vi.setSystemTime(Date.now() - 2 * 3_600_000);
            return await newSessionCookie("proj_expired");
          } finally {
            vi.useRealTimers();
          }
        },
      ],
    ];

    const rows = ["GET", "DELETE"].flatMap((method) =>
      cookies.map(([what, cookie]) => ({ method, what, cookie })),
    );

    test.each(rows)("$method with $what", async ({ method, cookie }) => {
      const value = await cookie();
      const res = await fetch(`${BASE}/sessions/me`, {
        method,
        headers: value ? { cookie: value } : {},
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        code: "auth.unauthorized",
        message: "Missing or invalid session token.",
      });
    });
  });

  test("GET /console/runtime.json names the project the console signs into", async () => {
    // Not in the OpenAPI spec: the Go server serves it from its root mux
    // (Console ADR 0004 §3). The console's mock dev loop boots on it, so the
    // path and both fields are the contract. The platform project, so a
    // console session can complete a claim (see the claim lifecycle below).
    const res = await fetch(`${BASE}/console/runtime.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "standalone",
      console_project_id: PLATFORM_PROJECT_ID,
    });
  });

  test("POST /projects returns the spec-defined project shape", async () => {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "conformance-app",
        origins: [{ pattern: "http://localhost:3000", kind: "preview" }],
        seed_defaults: false,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(() => CreateProjectResponse.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      name: "conformance-app",
      origins: [{ pattern: "http://localhost:3000", kind: "preview" }],
    });
  });

  test("GET /projects/:id matches GetProjectResponse", async () => {
    const create = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "conformance-app",
        origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await fetch(`${BASE}/projects/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => GetProjectResponse.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
    });
  });

  test("POST /projects/:id/origins adds a pattern and is idempotent for the same kind", async () => {
    const create = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "origins-app", seed_defaults: false }),
    });
    const { id } = (await create.json()) as { id: string };

    const first = await fetch(`${BASE}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://app.example.com", kind: "primary" }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(() => AddOriginResponse.parse(firstBody)).not.toThrow();
    expect(firstBody).toEqual({ pattern: "https://app.example.com", kind: "primary" });
    expect(firstBody).not.toHaveProperty("check");
    expect(firstBody).not.toHaveProperty("warning");

    const again = await fetch(`${BASE}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://app.example.com", kind: "primary" }),
    });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ pattern: "https://app.example.com", kind: "primary" });

    const conflict = await fetch(`${BASE}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://app.example.com", kind: "preview" }),
    });
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as Record<string, unknown>;
    expect(conflictBody.code).toBe("origin.kind_conflict");
  });

  test("POST /projects/:id/origins/remove is idempotent 204", async () => {
    const create = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "origins-remove-app",
        origins: [{ pattern: "https://preview.example.com", kind: "preview" }],
        seed_defaults: false,
      }),
    });
    const { id } = (await create.json()) as { id: string };

    const remove = await fetch(`${BASE}/projects/${id}/origins/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://preview.example.com" }),
    });
    expect(remove.status).toBe(204);

    const again = await fetch(`${BASE}/projects/${id}/origins/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://preview.example.com" }),
    });
    expect(again.status).toBe(204);

    const get = await fetch(`${BASE}/projects/${id}`);
    const body = await get.json();
    expect(body.origins).toEqual([]);
  });

  test("GET /projects/:id on unknown id returns spec-compliant error envelope", async () => {
    const res = await fetch(`${BASE}/projects/proj-does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("not_found");
    expect(typeof body.message).toBe("string");
  });

  test("POST /schemas returns 201 with a schema id", async () => {
    const res = await fetch(`${BASE}/schemas?project_id=proj_conformance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
        objectType: "conformance",
        // Mirrors the server's designation rule (ADR 058 §1): password
        // requires a designated project-unique identifier.
        "x-identifier": "email",
        "x-auth-methods": { password: { enabled: true } },
        properties: { email: { type: "string", format: "email", "x-unique": "project" } },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe("string");
    expect((body.id as string).startsWith("sch_")).toBe(true);
  });

  test("GET and DELETE /schemas/:id look up by id without project_id", async () => {
    const create = await fetch(`${BASE}/schemas?project_id=proj_schema_owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
        objectType: "conformance",
        // Mirrors the server's designation rule (ADR 058 §1): password
        // requires a designated project-unique identifier.
        "x-identifier": "email",
        "x-auth-methods": { password: { enabled: true } },
        properties: { email: { type: "string", format: "email", "x-unique": "project" } },
      }),
    });
    const { id } = (await create.json()) as { id: string };

    // Flat-by-id: OpenAPI dropped the project_id query; ownership is an
    // authz concern on the real server (RSI + Check).
    const missing = await fetch(`${BASE}/schemas/sch_does_not_exist`);
    expect(missing.status).toBe(404);

    const ownerGet = await fetch(`${BASE}/schemas/${id}`);
    expect(ownerGet.status).toBe(200);
    const ownerDelete = await fetch(`${BASE}/schemas/${id}`, {
      method: "DELETE",
    });
    expect(ownerDelete.status).toBe(204);
  });

  test("GET /schemas/:id round-trips the raw uploaded document inside the envelope (no zod re-shaping)", async () => {
    // The real server persists the uploaded JSON Schema bytes verbatim, and
    // schema documents legitimately carry fields the request zod strips
    // (title, description, custom x-* extensions). The mock must do the same,
    // serving the document under `schema` in the {id, schema, metadata}
    // envelope.
    const doc = {
      kind: "user-schema",
      metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
      objectType: "conformance",
      "x-auth-methods": { password: { enabled: true } },
      title: "CustomTitle",
      "x-custom-extension": { keep: true },
    };
    const create = await fetch(`${BASE}/schemas?project_id=proj_schema_raw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await fetch(`${BASE}/schemas/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      schema: unknown;
      metadata: { created_at: string };
    };
    expect(body.id).toBe(id);
    expect(body.schema).toEqual(doc);
    expect(typeof body.metadata.created_at).toBe("string");
  });

  test("GET /schemas lists envelopes carrying the full document", async () => {
    const doc = {
      kind: "user-schema",
      metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
      objectType: "conformance-list",
      "x-auth-methods": { password: { enabled: true } },
    };
    const create = await fetch(`${BASE}/schemas?project_id=proj_schema_list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await fetch(`${BASE}/schemas?project_id=proj_schema_list`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemas: Array<{ id: string; schema: unknown; metadata: { created_at: string } }>;
    };
    const row = body.schemas.find((entry) => entry.id === id);
    expect(row?.schema).toEqual(doc);
    expect(typeof row?.metadata.created_at).toBe("string");
  });

  test("GET /schemas pages with limit and next_page_token", async () => {
    // The consumer suites replace this handler with local MSW handlers, so
    // the mock's own slicing, token emission and continuation are only
    // proven here.
    for (let i = 0; i < 5; i += 1) {
      const create = await fetch(`${BASE}/schemas?project_id=proj_schema_paging`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "user-schema",
          metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
          objectType: `paging-${i}`,
          "x-auth-methods": { password: { enabled: true } },
        }),
      });
      expect(create.status).toBe(201);
    }

    // The whole set fits in the default limit of 20: no token.
    const full = await fetch(`${BASE}/schemas?project_id=proj_schema_paging`);
    expect(full.status).toBe(200);
    const fullBody = (await full.json()) as {
      schemas: Array<{ id: string }>;
      next_page_token?: string | null;
    };
    expect(fullBody.schemas).toHaveLength(5);
    expect(fullBody.next_page_token ?? undefined).toBeUndefined();
    const wantIds = fullBody.schemas.map((row) => row.id);

    // A limit-2 walk covers the same rows in the same order, exactly once;
    // every page before the end carries a token, the last does not.
    const gotIds: string[] = [];
    let token: string | undefined;
    for (const wantSize of [2, 2, 1]) {
      const url = new URL(`${BASE}/schemas`);
      url.searchParams.set("project_id", "proj_schema_paging");
      url.searchParams.set("limit", "2");
      if (token !== undefined) url.searchParams.set("page_token", token);
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const body = (await page.json()) as {
        schemas: Array<{ id: string }>;
        next_page_token?: string | null;
      };
      expect(body.schemas).toHaveLength(wantSize);
      gotIds.push(...body.schemas.map((row) => row.id));
      token = body.next_page_token ?? undefined;
    }
    expect(token).toBeUndefined();
    expect(gotIds).toEqual(wantIds);

    // A token the mock never minted is rejected, like the real server.
    const bad = await fetch(
      `${BASE}/schemas?project_id=proj_schema_paging&page_token=not-a-cursor`,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("req.invalid");

    // An out-of-range limit is rejected by the generated query schema, not
    // silently clamped.
    const oversized = await fetch(`${BASE}/schemas?project_id=proj_schema_paging&limit=101`);
    expect(oversized.status).toBe(400);
  });

  test("POST /schemas with invalid kind returns spec-compliant 400 envelope", async () => {
    const res = await fetch(`${BASE}/schemas?project_id=proj_conformance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "not-a-real-kind" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("invalid_schema");
  });

  test("POST /flow_definitions returns a body matching GetFlowDefinitionResponse (envelope is identical)", async () => {
    const res = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // POST 201 and GET 200 share the `flow-definition-response`
    // envelope per the spec, so the GET response zod schema validates both.
    expect(() => GetFlowDefinitionResponse.parse(body)).not.toThrow();
  });

  test("POST /flow_definitions stores a schema id as the objectType it names", async () => {
    const schema = await fetch(`${BASE}/schemas?project_id=proj_conformance_handle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
        objectType: "conformance-handle",
        "x-auth-methods": { passkey: { enabled: true } },
        properties: { email: { type: "string", format: "email", "x-unique": "project" } },
      }),
    });
    const { id } = (await schema.json()) as { id: string };

    const res = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_handle",
        flow_definition: { ...validFlowDefinitionBody(), user_schema: id },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { flow_definition: { user_schema: string } };
    expect(body.flow_definition.user_schema).toBe("conformance-handle");
  });

  test("POST /flow_definitions rejects an invalid definition with the server's flowdef.invalid envelope", async () => {
    const flowDefinition = validFlowDefinitionBody();
    // Wire register as a purpose without the flip transition — the exact
    // class of definition the real server rejects at apply time.
    flowDefinition.purposes = { login: "identifier", register: "identifier" };
    const res = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "proj_conformance", flow_definition: flowDefinition }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string; details: string };
    expect(body.code).toBe("flowdef.invalid");
    expect(body.message).toBe("flow definition: invalid");
    expect(body.details).toContain('must wire "user_not_found" transition');
  });

  test("POST /flow_definitions with a repeated name publishes a new revision", async () => {
    const publish = async () => {
      const res = await fetch(`${BASE}/flow_definitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: "proj_conformance_revisions",
          flow_definition: validFlowDefinitionBody(),
        }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const first = await publish();
    const second = await publish();
    expect(second).not.toBe(first);
    // The server mints flow definition ids under the `flowdef` prefix (ADR 047).
    expect([first, second].every((id) => id.startsWith("flowdef_"))).toBe(true);

    // The name filter lists that flow's revisions, newest first.
    const res = await fetch(
      `${BASE}/flow_definitions?project_id=proj_conformance_revisions&name=login-flow`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flow_definitions: { id: string }[] };
    expect(body.flow_definitions.map((entry) => entry.id)).toEqual([second, first]);

    const none = await fetch(
      `${BASE}/flow_definitions?project_id=proj_conformance_revisions&name=no-such-flow`,
    );
    expect(((await none.json()) as { flow_definitions: unknown[] }).flow_definitions).toEqual([]);
  });

  test("GET /flow_definitions?revisions=latest keeps one revision per name and honours purpose", async () => {
    const publish = async (overrides: Record<string, unknown>) => {
      const res = await fetch(`${BASE}/flow_definitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: "proj_conformance_latest",
          flow_definition: { ...validFlowDefinitionBody(), ...overrides },
        }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const loginV1 = await publish({ name: "latest-login" });
    const loginV2 = await publish({ name: "latest-login" });
    const registerV1 = await publish({
      name: "latest-register",
      purposes: { register: "identifier" },
    });

    const list = async (params: string) => {
      const res = await fetch(
        `${BASE}/flow_definitions?project_id=proj_conformance_latest${params}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { flow_definitions: { id: string }[] };
      return body.flow_definitions.map((entry) => entry.id);
    };

    // `all` stays the default and keeps every revision, newest first.
    expect(await list("")).toEqual([registerV1, loginV2, loginV1]);
    // `latest` keeps the newest revision of each name.
    expect(await list("&revisions=latest")).toEqual([registerV1, loginV2]);
    // The purpose filter applies to the surviving revisions.
    expect(await list("&revisions=latest&purpose=register")).toEqual([registerV1]);
    expect(await list("&revisions=latest&purpose=login")).toEqual([loginV2]);
  });

  test("GET /flow_definitions matches ListFlowDefinitionsResponse", async () => {
    // Ensure at least one entry exists so the list is non-trivial.
    const create = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_list",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    const { id } = (await create.json()) as { id: string };
    // Spec: `ListFlowDefinitionsQueryParams` requires `project_id`.
    const res = await fetch(`${BASE}/flow_definitions?project_id=proj_conformance_list`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => ListFlowDefinitionsResponse.parse(body)).not.toThrow();

    // Both read endpoints describe a flow definition the same way (#939), so
    // the row and the by-id document must be the same object.
    const row = (body as { flow_definitions: { id: string }[] }).flow_definitions.find(
      (entry) => entry.id === id,
    );
    const detail = await (await fetch(`${BASE}/flow_definitions/${id}`)).json();
    expect(row).toEqual(detail);
  });

  test("GET /flow_definitions/:id matches GetFlowDefinitionResponse", async () => {
    const create = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_get",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await fetch(`${BASE}/flow_definitions/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => GetFlowDefinitionResponse.parse(body)).not.toThrow();
  });
});

describe("api-mock claim lifecycle — init / status / complete conformance", () => {
  async function createProject(name: string): Promise<{ id: string; projectSecret: string }> {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { id: string; project_secret: string };
    return { id: body.id, projectSecret: body.project_secret };
  }

  async function initClaim(projectId: string, secret: string): Promise<Response> {
    return fetch(`${BASE}/projects/${projectId}/claim/init`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
  }

  async function claimStatus(
    projectId: string,
    challengeId: string,
    secret: string,
  ): Promise<Response> {
    return fetch(
      `${BASE}/projects/${projectId}/claim/status?challenge_id=${encodeURIComponent(challengeId)}`,
      { headers: { authorization: `Bearer ${secret}` } },
    );
  }

  // A session belonging to `project`, active with a verified factor. The claim
  // page runs in the platform project, so an eligible claim session uses
  // PLATFORM_PROJECT_ID; passing a customer project yields an ineligible one.
  async function sessionCookie(project: string): Promise<string> {
    const handoff = await signHandoffToken({ sub: project, iss: BASE });
    const exchange = await fetch(`${BASE}/sessions/exchange?project_id=${project}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    const setCookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("__nextgen_session="));
    return setCookie?.split(";")[0] ?? "";
  }

  const platformSessionCookie = () => sessionCookie(PLATFORM_PROJECT_ID);

  /**
   * The headers a cookie-authenticated claim/complete sends: the cookie plus
   * the session's CSRF token from GET /sessions/me/csrf (ADR 053 §5). A session
   * it rejects gets an empty token, which the credential check
   * refuses first anyway.
   */
  async function claimHeaders(cookie: string): Promise<Record<string, string>> {
    const me = await fetch(`${BASE}/sessions/me/csrf`, { headers: { cookie } });
    const token = me.ok ? (((await me.json()) as { csrf_token?: string }).csrf_token ?? "") : "";
    return { "content-type": "application/json", cookie, "x-zitadel-csrf": token };
  }

  test("POST /projects/:id/claim/init returns 201 with a claim challenge", async () => {
    const project = await createProject("claim-init");
    const res = await initClaim(project.id, project.projectSecret);
    expect(res.status).toBe(201);
    // orval emits no `*Response` zod for a 201 body — validate structurally,
    // mirroring the POST /projects test above.
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.challenge_id).toBe("string");
    expect(() => new URL(body.claim_url as string)).not.toThrow();
    expect(new Date(body.expires_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  test("the store snapshot exposes minted challenge ids", async () => {
    // A test driving the mock over HTTP (the CLI suite) never sees the init
    // response body, so the snapshot is its only route to the id the
    // completion and expiry mutators take.
    const project = await createProject("claim-snapshot");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    expect(snapshotPlatformStore().claimChallengeIds).toContain(challenge_id);
  });

  test("GET /projects/:id/claim/status is pending before completion", async () => {
    const project = await createProject("claim-status-pending");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => GetClaimStatusResponse.parse(body)).not.toThrow();
    const parsed = body as Record<string, unknown>;
    expect(parsed.status).toBe("pending");
    expect(parsed.team_id).toBeUndefined();
    expect(parsed.claimed_at).toBeUndefined();
    expect(parsed.dashboard_url).toBeUndefined();
  });

  test("GET /projects/:id/claim/status with a foreign project secret returns 403", async () => {
    const project = await createProject("claim-status-owner");
    const other = await createProject("claim-status-foreign");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await claimStatus(project.id, challenge_id, other.projectSecret);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("proj.permission_denied");
  });

  test("full flow: init → complete with session cookie → status completed", async () => {
    const project = await createProject("claim-full-flow");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie();
    const complete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(200);
    const completeBody = await complete.json();
    expect(() => CompleteClaimResponse.parse(completeBody)).not.toThrow();
    const completed = completeBody as Record<string, unknown>;
    expect(completed.project_id).toBe(project.id);
    expect(typeof completed.team_id).toBe("string");
    expect(typeof completed.claimed_at).toBe("string");

    const status = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(() => GetClaimStatusResponse.parse(statusBody)).not.toThrow();
    const parsed = statusBody as Record<string, unknown>;
    expect(parsed.status).toBe("completed");
    expect(typeof parsed.team_id).toBe("string");
    expect(typeof parsed.claimed_at).toBe("string");
    expect(() => new URL(parsed.dashboard_url as string)).not.toThrow();
  });

  test("POST /projects/:id/claim/init returns 409 once the project is claimed", async () => {
    const project = await createProject("claim-already-claimed");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie();
    await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });

    const res = await initClaim(project.id, project.projectSecret);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; details: Record<string, unknown> };
    expect(body.code).toBe("proj.already_claimed");
    expect(typeof body.details.team_id).toBe("string");
    expect(() => new URL(body.details.dashboard_url as string)).not.toThrow();
  });

  test("an expired challenge makes status and complete return 410", async () => {
    const project = await createProject("claim-expired");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    expireClaimChallenge(challenge_id);

    const status = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(410);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.code).toBe("proj.claim_expired");

    const cookie = await platformSessionCookie();
    const complete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(410);
    const completeBody = (await complete.json()) as Record<string, unknown>;
    expect(completeBody.code).toBe("proj.claim_expired");
  });

  test("a closed claim window makes init and complete return 410 claim_window_expired", async () => {
    const project = await createProject("claim-window-expired");
    // Mint the challenge while the window is open, then close it: complete
    // must refuse even a live challenge once the project is too old.
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    expireClaimWindow(project.id);

    const reinit = await initClaim(project.id, project.projectSecret);
    expect(reinit.status).toBe(410);
    const reinitBody = (await reinit.json()) as Record<string, unknown>;
    expect(reinitBody.code).toBe("proj.claim_window_expired");

    // The poll must learn the same final refusal, not the retryable
    // challenge expiry, so a CLI mid-poll stops suggesting a fresh claim.
    const status = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(410);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.code).toBe("proj.claim_window_expired");

    const cookie = await platformSessionCookie();
    const complete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(410);
    const completeBody = (await complete.json()) as Record<string, unknown>;
    expect(completeBody.code).toBe("proj.claim_window_expired");

    // Both expired at once: the final window refusal must win over the
    // retryable challenge expiry, on status and complete alike.
    expireClaimChallenge(challenge_id);
    const bothStatus = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(bothStatus.status).toBe(410);
    expect(((await bothStatus.json()) as Record<string, unknown>).code).toBe(
      "proj.claim_window_expired",
    );
    const bothComplete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(bothComplete.status).toBe(410);
    expect(((await bothComplete.json()) as Record<string, unknown>).code).toBe(
      "proj.claim_window_expired",
    );
  });

  test("POST /projects/:id/claim/complete without a session cookie returns 401", async () => {
    const project = await createProject("claim-complete-no-cookie");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("POST /projects/:id/claim/complete without the CSRF token returns 403", async () => {
    const project = await createProject("claim-complete-no-csrf");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie();
    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.csrf_invalid");
  });

  test("POST /projects/:id/claim/complete with an unknown challenge returns 404", async () => {
    const project = await createProject("claim-complete-unknown");
    const cookie = await platformSessionCookie();
    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id: "ch_doesnotexist" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /projects/:id/claim/complete without challenge_id returns 400", async () => {
    const project = await createProject("claim-complete-missing-id");
    const cookie = await platformSessionCookie();
    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /projects/:id/claim/init with another project's secret returns 404", async () => {
    const project = await createProject("claim-init-owner");
    const other = await createProject("claim-init-foreign");
    const res = await initClaim(project.id, other.projectSecret);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("proj.not_found");
  });

  test("GET /projects/:id/claim/status without a bearer token returns 401", async () => {
    const project = await createProject("claim-status-no-bearer");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await fetch(
      `${BASE}/projects/${project.id}/claim/status?challenge_id=${encodeURIComponent(challenge_id)}`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("POST /projects/:id/claim/complete with a customer-project session returns 401", async () => {
    const project = await createProject("claim-complete-ineligible");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    // A session for the customer project, not the platform project, must not
    // be able to claim (ADR 046 §2).
    const cookie = await sessionCookie(project.id);
    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("POST /projects/:id/claim/complete on a mismatched project returns 404", async () => {
    const project = await createProject("claim-complete-path-a");
    const other = await createProject("claim-complete-path-b");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie();
    const res = await fetch(`${BASE}/projects/${other.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(404);
  });

  test("a claim challenge is single-use: a second completion returns 409", async () => {
    const project = await createProject("claim-single-use");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie();
    const url = `${BASE}/projects/${project.id}/claim/complete`;
    const body = JSON.stringify({ challenge_id });
    const headers = await claimHeaders(cookie);

    const first = await fetch(url, { method: "POST", headers, body });
    expect(first.status).toBe(200);

    const second = await fetch(url, { method: "POST", headers, body });
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as { code: string; details: Record<string, unknown> };
    expect(secondBody.code).toBe("proj.already_claimed");
    expect(typeof secondBody.details.team_id).toBe("string");
    expect(() => new URL(secondBody.details.dashboard_url as string)).not.toThrow();
  });

  // Mirrors the server: the grant is the claim source of truth, so a claim
  // that landed stays reported as completed even after its challenge's TTL.
  test("a completed claim stays completed on status past challenge expiry", async () => {
    const project = await createProject("claim-completed-expired");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie();
    const complete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(200);

    expireClaimChallenge(challenge_id);
    const status = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.status).toBe("completed");
    expect(typeof statusBody.team_id).toBe("string");
  });

  // The grant, not the polled challenge, is the truth: a poll on a pending
  // challenge whose project was claimed through ANOTHER challenge reports
  // completed with the owning team, even once the claim window has closed —
  // never a false "can no longer be claimed" verdict.
  test("a pending challenge on a project claimed elsewhere reports completed", async () => {
    const project = await createProject("claim-cross-challenge-status");
    const first = await initClaim(project.id, project.projectSecret);
    const { challenge_id: polled } = (await first.json()) as { challenge_id: string };
    const second = await initClaim(project.id, project.projectSecret);
    const { challenge_id: winner } = (await second.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie();
    const complete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(cookie),
      body: JSON.stringify({ challenge_id: winner }),
    });
    expect(complete.status).toBe(200);
    expireClaimWindow(project.id);

    const status = await claimStatus(project.id, polled, project.projectSecret);
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.status).toBe("completed");
    expect(typeof statusBody.team_id).toBe("string");
  });
});

/**
 * The identity provider connection and variable endpoints the CLI's SSO journey
 * needs. The Go service does not exist yet (#1003), so this mock is the only
 * place `auth-method sso enable` / `plan` / `apply` can be driven end to end.
 */
describe("api-mock idp connections and variables", () => {
  const connection = (over: Record<string, unknown> = {}) => ({
    slug: "google",
    protocol: "oidc",
    template: "google",
    display_name: "Google",
    subject_claim: "sub",
    provisioning: { creation: "auto" },
    oidc: {
      issuer: "https://accounts.google.com",
      scopes: ["openid", "profile", "email"],
      client_id: "${{ GOOGLE_CLIENT_ID }}",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
    },
    ...over,
  });

  async function newProject(name: string): Promise<string> {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  async function putIdp(projectId: string, idp: object): Promise<Response> {
    return fetch(`${BASE}/idps?project_id=${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idp }),
    });
  }

  test("creates a connection and answers the generated response shape", async () => {
    const projectId = await newProject("idp-create");

    const res = await putIdp(projectId, connection());

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(CreateIdpResponse.safeParse(body).success).toBe(true);
    expect(body.slug).toBe("google");
    expect(String(body.id)).toMatch(/^idp_/);
    expect(String(body.revision_id)).toMatch(/^idprev_/);
  });

  test("a second write of the same slug revises it under one id", async () => {
    // This is what keeps `apply` idempotent: the schema and every flow step
    // reference the slug, so a second connection for it would orphan them.
    const projectId = await newProject("idp-revise");
    const first = (await (await putIdp(projectId, connection())).json()) as Record<string, unknown>;

    const second = await putIdp(projectId, connection({ display_name: "Google Workspace" }));

    expect(second.status).toBe(200);
    const body = (await second.json()) as Record<string, unknown>;
    expect(body.id).toBe(first.id);
    expect(body.revision_id).not.toBe(first.revision_id);
    expect((body.definition as Record<string, unknown>).display_name).toBe("Google Workspace");
  });

  describe("an oidc block that names only some endpoints", () => {
    // The server's rule: none (discovery), or authorization_endpoint, jwks_uri,
    // token_endpoint, and userinfo_endpoint unless id_token_mapping is true.
    const endpoints = {
      authorization_endpoint: "https://idp.test/authorize",
      jwks_uri: "https://idp.test/jwks",
      token_endpoint: "https://idp.test/token",
      userinfo_endpoint: "https://idp.test/userinfo",
    };
    const withOidc = (over: object) =>
      connection({
        oidc: {
          issuer: "https://idp.test",
          scopes: ["openid"],
          client_id: "${{ GOOGLE_CLIENT_ID }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          ...over,
        },
      });

    test.each<[string, object, string[]]>([
      [
        "one endpoint",
        { token_endpoint: endpoints.token_endpoint },
        ["authorization_endpoint", "jwks_uri", "userinfo_endpoint"],
      ],
      ["all but jwks_uri", { ...endpoints, jwks_uri: undefined }, ["jwks_uri"]],
      [
        "userinfo_endpoint alone under id_token_mapping",
        { userinfo_endpoint: endpoints.userinfo_endpoint, id_token_mapping: true },
        ["authorization_endpoint", "jwks_uri", "token_endpoint"],
      ],
    ])(
      "refuses %s with idp.endpoints_partial, listing what is missing",
      async (_case, over, missing) => {
        const projectId = await newProject("idp-endpoints-partial");

        const res = await putIdp(projectId, withOidc(over));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          code: "idp.endpoints_partial",
          message: "identity provider connection: the endpoints are partially set",
          details: { details: { missing } },
        });
      },
    );

    test("refuses a revision too, before the slug is looked up", async () => {
      const projectId = await newProject("idp-endpoints-partial-revise");
      expect((await putIdp(projectId, connection())).status).toBe(201);

      const res = await putIdp(projectId, withOidc({ jwks_uri: endpoints.jwks_uri }));

      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("idp.endpoints_partial");
    });

    test.each<[string, object]>([
      ["every endpoint", endpoints],
      [
        "every endpoint but userinfo under id_token_mapping",
        { ...endpoints, userinfo_endpoint: undefined, id_token_mapping: true },
      ],
    ])("accepts %s", async (_case, over) => {
      const projectId = await newProject("idp-endpoints-full");

      expect((await putIdp(projectId, withOidc(over))).status).toBe(201);
    });
  });

  test("reads one back by id, and 404s an id the project does not own", async () => {
    const mine = await newProject("idp-read-mine");
    const other = await newProject("idp-read-other");
    const created = (await (await putIdp(mine, connection())).json()) as { id: string };

    const ok = await fetch(`${BASE}/idps/${created.id}?project_id=${mine}`);
    expect(ok.status).toBe(200);
    expect(GetIdpByIdResponse.safeParse(await ok.json()).success).toBe(true);

    const foreign = await fetch(`${BASE}/idps/${created.id}?project_id=${other}`);
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { code: string }).code).toBe("idp.not_found");
  });

  test("lists only the project's own connections", async () => {
    const mine = await newProject("idp-list-mine");
    const other = await newProject("idp-list-other");
    await putIdp(mine, connection());
    await putIdp(other, connection({ slug: "github", template: "github" }));

    const res = await fetch(`${BASE}/idps/query?project_id=${mine}`, { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { idps: { slug: string }[] };
    expect(QueryIdpsResponse.safeParse(body).success).toBe(true);
    expect(body.idps.map((i) => i.slug)).toEqual(["google"]);
  });

  test("stores a variable and reads it back", async () => {
    const projectId = await newProject("vars-plain");

    const patch = await fetch(`${BASE}/variables?project_id=${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        GOOGLE_CLIENT_ID: { value: "824.apps.googleusercontent.com", secret: false },
      }),
    });
    // 200 with the addressed owner read back, not 204.
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as Record<string, unknown>).GOOGLE_CLIENT_ID).toEqual({
      primary: "824.apps.googleusercontent.com",
      preview: "824.apps.googleusercontent.com",
    });

    const res = await fetch(`${BASE}/variables?project_id=${projectId}`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(GetVariablesResponse.safeParse(body).success).toBe(true);
    expect(body.GOOGLE_CLIENT_ID).toEqual({
      primary: "824.apps.googleusercontent.com",
      preview: "824.apps.googleusercontent.com",
    });
  });

  test("reads and deletes one variable by name", async () => {
    const projectId = await newProject("vars-by-name");
    await fetch(`${BASE}/variables?project_id=${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ SESSION_TTL: { value: 900, secret: false } }),
    });

    const read = await fetch(`${BASE}/variables/SESSION_TTL?project_id=${projectId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ primary: 900, preview: 900 });

    const removed = await fetch(`${BASE}/variables/SESSION_TTL?project_id=${projectId}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect((await fetch(`${BASE}/variables/SESSION_TTL?project_id=${projectId}`)).status).toBe(404);
  });

  test("answers var.not_found for a name the project does not hold", async () => {
    const projectId = await newProject("vars-missing");

    const res = await fetch(`${BASE}/variables/ABSENT?project_id=${projectId}`);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code?: string }).code).toBe("var.not_found");
  });

  test.each([
    ["a name the schema rejects", "bad-name"],
    ["a name past the length cap", "N".repeat(256)],
  ])("refuses %s rather than reporting it missing", async (_label, name) => {
    // variable-name.yaml allows word characters up to 255, so an unusable name
    // is a bad request: answering `var.not_found` would tell a caller the name
    // is free when it could never be used.
    const projectId = await newProject("vars-invalid-name");

    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${BASE}/variables/${name}?project_id=${projectId}`, { method });
      expect(res.status, `${method} ${name}`).toBe(400);
    }
  });

  test("never reads a secret's value back", async () => {
    // ADR 062 §7: a secret can be replaced but not read. Returning the value
    // here would make the encryption it stands for pointless.
    const projectId = await newProject("vars-secret");
    await fetch(`${BASE}/variables?project_id=${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ GOOGLE_CLIENT_SECRET: { value: "GOCSPX-real", secret: true } }),
    });

    const body = (await (
      await fetch(`${BASE}/variables?project_id=${projectId}`)
    ).json()) as Record<string, unknown>;

    expect(body.GOOGLE_CLIENT_SECRET).toEqual({ primary: { secret: true } });
    expect(JSON.stringify(body)).not.toContain("GOCSPX-real");
  });

  test("patches rather than replaces, and null removes a name", async () => {
    const projectId = await newProject("vars-patch");
    const url = `${BASE}/variables?project_id=${projectId}`;
    const patch = (payload: object) =>
      fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    await patch({ KEEP: { value: "a", secret: false }, DROP: { value: "b", secret: false } });

    await patch({ DROP: null });

    const body = (await (await fetch(url)).json()) as Record<string, unknown>;
    expect(body.KEEP).toEqual({ primary: "a", preview: "a" });
    expect(body).not.toHaveProperty("DROP");
  });

  test("keeps one project's variables out of another's", async () => {
    const mine = await newProject("vars-mine");
    const other = await newProject("vars-other");
    await fetch(`${BASE}/variables?project_id=${mine}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MINE: { value: "x", secret: false } }),
    });

    const body = (await (await fetch(`${BASE}/variables?project_id=${other}`)).json()) as object;

    expect(body).toEqual({});
  });
});

/** The contract details the first pass of these endpoints got wrong. */
describe("api-mock idp and variable contract details", () => {
  const base = {
    slug: "google",
    protocol: "oidc",
    template: "google",
    display_name: "Google",
    subject_claim: "sub",
    provisioning: { creation: "auto" },
    oidc: {
      issuer: "https://accounts.google.com",
      scopes: ["openid"],
      client_id: "${{ GOOGLE_CLIENT_ID }}",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
    },
  };

  async function newProject(name: string): Promise<string> {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  const putIdp = (projectId: string, idp: object) =>
    fetch(`${BASE}/idps?project_id=${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idp }),
    });

  const queryIdps = (projectId: string, body: object) =>
    fetch(`${BASE}/idps/query?project_id=${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("refuses a revision that changes the connection's identity", async () => {
    // protocol, subject_claim and the authority decide which provider account a
    // stored subject belongs to, so changing one repoints existing identities
    // rather than reconfiguring them.
    const projectId = await newProject("idp-immutable");
    await putIdp(projectId, base);

    const repointed = await putIdp(projectId, {
      ...base,
      oidc: { ...base.oidc, issuer: "https://login.microsoftonline.com/common/v2.0" },
    });

    expect(repointed.status).toBe(400);
    expect(((await repointed.json()) as { code: string }).code).toBe("idp.field_immutable");
  });

  test("accepts a revision that changes something mutable", async () => {
    const projectId = await newProject("idp-mutable");
    await putIdp(projectId, base);

    const revised = await putIdp(projectId, {
      ...base,
      oidc: { ...base.oidc, scopes: ["openid", "profile"] },
    });

    expect(revised.status).toBe(200);
  });

  test("applies a slug filter instead of returning every connection", async () => {
    const projectId = await newProject("idp-filter");
    await putIdp(projectId, base);
    await putIdp(projectId, { ...base, slug: "acme", template: "oidc-generic" });

    const res = await queryIdps(projectId, {
      filter: [{ field: "slug", operation: "equals", value: "acme" }],
    });

    const body = (await res.json()) as { idps: { slug: string }[] };
    expect(body.idps.map((i) => i.slug)).toEqual(["acme"]);
  });

  test("honours limit and sort direction", async () => {
    const projectId = await newProject("idp-sort");
    await putIdp(projectId, base);
    await putIdp(projectId, { ...base, slug: "acme", template: "oidc-generic" });

    const res = await queryIdps(projectId, {
      limit: 1,
      sorting: { field: "slug", direction: "desc" },
    });

    const body = (await res.json()) as { idps: { slug: string }[] };
    expect(body.idps.map((i) => i.slug)).toEqual(["google"]);
  });

  test("rejects a malformed query body rather than ignoring it", async () => {
    const projectId = await newProject("idp-badquery");

    const res = await queryIdps(projectId, { limit: "lots" });

    expect(res.status).toBe(400);
  });

  test("keeps each kind's value separate", async () => {
    // Nothing falls back between kinds: a preview value is its own, and a
    // removal naming a kind leaves the other kind's value.
    const projectId = await newProject("vars-kinds");
    const url = (kind?: string) =>
      `${BASE}/variables?project_id=${projectId}${kind === undefined ? "" : `&kind=${kind}`}`;
    const write = (kind: string | undefined, payload: object) =>
      fetch(url(kind), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    await write(undefined, { SHARED: "prod" });
    await write("preview", { SHARED: "test" });

    expect(await (await fetch(url())).json()).toEqual({
      SHARED: { primary: "prod", preview: "test" },
    });
    expect(await (await fetch(url("primary"))).json()).toEqual({ SHARED: { primary: "prod" } });

    const removed = await fetch(`${BASE}/variables/SHARED?project_id=${projectId}&kind=preview`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect(
      (await fetch(`${BASE}/variables/SHARED?project_id=${projectId}&kind=preview`)).status,
    ).toBe(404);
    expect(await (await fetch(url())).json()).toEqual({ SHARED: { primary: "prod" } });
  });

  test("writes a secret naming no kind for primary only, removing the preview value", async () => {
    const projectId = await newProject("vars-secret-kind");
    const url = `${BASE}/variables?project_id=${projectId}`;
    await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ TOKEN: "plain", HOST: "example.com" }),
    });
    await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ TOKEN: { value: "s3cr3t", secret: true } }),
    });

    expect(await (await fetch(url)).json()).toEqual({
      TOKEN: { primary: { secret: true } },
      HOST: { primary: "example.com", preview: "example.com" },
    });
  });

  test("answers not_implemented for a deployment's variables", async () => {
    const projectId = await newProject("vars-deployment");

    const res = await fetch(
      `${BASE}/deployments/dep_01KX5N7C9D2E7F0N9WD3P2E4YM6/variables?project_id=${projectId}`,
    );

    expect(res.status).toBe(501);
    expect(((await res.json()) as { code?: string }).code).toBe("not_implemented");
  });

  test("reads back what the write did not touch", async () => {
    const projectId = await newProject("vars-readback");
    const url = `${BASE}/variables?project_id=${projectId}`;
    const write = (payload: object) =>
      fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    await write({ FIRST: { value: "a", secret: false } });

    const second = await write({ SECOND: { value: "b", secret: false } });

    const body = (await second.json()) as Record<string, unknown>;
    expect(body).toEqual({
      FIRST: { primary: "a", preview: "a" },
      SECOND: { primary: "b", preview: "b" },
    });
  });
});
