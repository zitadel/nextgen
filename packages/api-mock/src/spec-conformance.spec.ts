/**
 * Spec-conformance test for the api-mock.
 *
 * It boots the real Express mock server and drives every route over HTTP.
 * Every answer to an operation of the OpenAPI spec goes through
 * `conformantFetch` (`src/__tests__/mock-routes.ts`), which fails the request
 * when the answer breaks the contract (`src/__tests__/spec-contract.ts`): a
 * status the operation does not declare, a success body orval's zod refuses,
 * or an error body outside the operation's declared error set. That proves a
 * code is one the operation declares, not that it is the right one, and every
 * operation's `default` lets any error status through.
 *
 * The last describe reads the routes off the handlers themselves and fails a
 * route that is neither a spec operation nor listed in
 * `src/__tests__/spec-exceptions.ts`, a server route with no success answer,
 * and an in-process route with no answer at all. Only answers through this
 * file's `fetch` count, so a new handler needs its tests here.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { API_PREFIX } from "@zitadel/api/runtime/base-url";
import { describe, expect } from "vitest";

import { test as base } from "./__tests__/fixtures.js";
import {
  IN_PROCESS_ORIGIN,
  conformantFetch,
  mockRoutes,
  observations,
  routeKey,
} from "./__tests__/mock-routes.js";
import { OUT_OF_SPEC_ROUTES } from "./__tests__/spec-exceptions.js";
import { specOperations } from "./__tests__/spec-contract.js";
import { signHandoffToken } from "./crypto.js";
import { PASSWORD_FIELD } from "./fixtures/login.js";
import { setupMockHandlers } from "./handlers.js";
import {
  expireClaimChallenge,
  expireClaimWindow,
  snapshotPlatformStore,
} from "./platform-handlers.js";
import { PLATFORM_PROJECT_ID, createMockApp, csrfTokenFor } from "./server.js";

/**
 * Every request below goes through the contract: an answer to a spec
 * operation that breaks it throws (`src/__tests__/spec-contract.ts`), and the
 * last describe proves every route was exercised.
 */
const fetch = conformantFetch;

/** The mock server a test drives: its origin, and where it serves the API. */
interface MockServer {
  /** The origin the server listens on, also the issuer its handoff tokens name. */
  base: string;
  /** Where the mock serves the API, as the server does: under `/api/v1` (ADR 077). */
  api: string;
}

/**
 * `test` with a `mock` fixture: the real Express mock listening on a free port for the whole file,
 * closed once the last test of the file has run.
 */
const test = base.extend<{ mock: MockServer }>({
  mock: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, () => resolve());
      });
      const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
      server.on("request", createMockApp({ issuer: origin }));
      await use({ base: origin, api: `${origin}/api/v1` });
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
    { scope: "file" },
  ],
});

/**
 * The `zitadel_session` cookie of a session belonging to `project`, active
 * with a verified factor.
 *
 * @param mock - The mock server the request goes to.
 */
async function sessionCookie(mock: MockServer, project: string): Promise<string> {
  const handoff = await signHandoffToken({ sub: project, iss: mock.base });
  const exchange = await fetch(`${mock.api}/sessions/exchange?project_id=${project}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoff_token: handoff }),
  });
  const setCookie = exchange.headers.getSetCookie().find((c) => c.startsWith("zitadel_session="));
  return setCookie?.split(";")[0] ?? "";
}

/**
 * Helper: a valid flow-definition body that satisfies the spec's
 * `flow-definition.yaml` required fields. Used by the flow_definitions
 * tests so the response (which inlines this body) passes zod validation.
 */
function validFlowDefinitionBody(): Record<string, unknown> {
  return {
    name: "login-flow",
    user_schema:
      "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/apps/api/api/openapi/endpoints/schemas/user-schema.yaml",
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

describe("api-mock spec conformance — sessions, projects, schemas and flow definitions", () => {
  test("POST /sessions/exchange exchanges a handoff token", async ({ mock }) => {
    const handoff = await signHandoffToken({ sub: "proj_test", iss: mock.base });
    const res = await fetch(`${mock.api}/sessions/exchange?project_id=proj_test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(res.status).toBe(200);
  });

  test("GET /sessions/me resolves a display for the known demo identities", async ({ mock }) => {
    const handoff = await signHandoffToken({ sub: "ada@example.com", iss: mock.base });
    const exchange = await fetch(`${mock.api}/sessions/exchange?project_id=proj_me_display`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("zitadel_session="))
      ?.split(";")[0];

    const res = await fetch(`${mock.api}/sessions/me`, { headers: { cookie: cookie ?? "" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.user).toMatchObject({
      identifier: "ada@example.com",
      identifier_property: "email",
      display: "Ada Lovelace",
    });
  });

  // Mirrors the server on loopback http (ADR 083): it sets zitadel_session,
  // reads it and the canonical name the SDK proxies send upstream, the
  // canonical one first, and reads no session cookie from before ADR 083.
  test("GET /sessions/me reads the session under both of its names, and no old one", async ({
    mock,
  }) => {
    const pair = await sessionCookie(mock, "proj_me_names");
    const token = pair.slice(pair.indexOf("=") + 1);
    expect(pair).toBe(`zitadel_session=${token}`);

    for (const [cookie, status] of [
      [`zitadel_session=${token}`, 200],
      [`__Host-zitadel_session=${token}`, 200],
      [`zitadel_session=deadbeef; __Host-zitadel_session=${token}`, 200],
      [`__nextgen_session=${token}`, 401],
      [`__nextgen_session_proj_me_names=${token}`, 401],
    ] as const) {
      const res = await fetch(`${mock.base}/sessions/me`, { headers: { cookie } });
      expect({ cookie, status: res.status }).toEqual({ cookie, status });
    }
  });

  // Mirrors the server: a read that names a project refuses a session of any
  // other project, and serves its own as before.
  test("GET /sessions/me with project_id refuses a session of another project", async ({
    mock,
  }) => {
    const handoff = await signHandoffToken({ sub: "app-user@example.com", iss: mock.base });
    const exchange = await fetch(`${mock.api}/sessions/exchange?project_id=proj_me_app`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("zitadel_session="))
      ?.split(";")[0];

    const refused = await fetch(`${mock.api}/sessions/me?project_id=proj_me_other`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "sess.project_mismatch" });

    const served = await fetch(`${mock.api}/sessions/me?project_id=proj_me_app`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(served.status).toBe(200);
    expect(await served.json()).toMatchObject({ project_id: "proj_me_app" });

    // Like the server, a project_id outside the project-id pattern is a bad
    // request, not a verdict on the session.
    for (const invalid of ["", "proj%20me"]) {
      const rejected = await fetch(`${mock.api}/sessions/me?project_id=${invalid}`, {
        headers: { cookie: cookie ?? "" },
      });
      expect(rejected.status).toBe(400);
    }
  });

  // Mirrors the server: the CSRF token read and sign-out hold the session to
  // the project they name the way the read does, and a refused sign-out leaves
  // the session and its cookie alone.
  test("GET /sessions/me/csrf and DELETE /sessions/me with project_id refuse a session of another project", async ({
    mock,
  }) => {
    const cookie = await sessionCookie(mock, "proj_me_signout");
    const headers = { cookie };
    // Sign-out is a write: it carries the session's CSRF token, which is
    // checked before the project hold and the parameter, as on the server.
    const signOutHeaders = { cookie, "x-zitadel-csrf": csrfTokenFor(cookie.split("=")[1] ?? "") };

    const refusedToken = await fetch(`${mock.api}/sessions/me/csrf?project_id=proj_me_other`, {
      headers,
    });
    expect(refusedToken.status).toBe(403);
    expect(refusedToken.headers.get("cache-control")).toBe("private, no-store");
    expect(await refusedToken.json()).toMatchObject({ code: "sess.project_mismatch" });

    const refusedSignOut = await fetch(`${mock.api}/sessions/me?project_id=proj_me_other`, {
      method: "DELETE",
      headers: signOutHeaders,
    });
    expect(refusedSignOut.status).toBe(403);
    expect(await refusedSignOut.json()).toMatchObject({ code: "sess.project_mismatch" });
    expect(refusedSignOut.headers.getSetCookie()).toEqual([]);

    // A project_id that is no project id is a bad request, one shaped as an
    // object by the query parser too. The server authenticates first, so
    // without a cookie the answer is the 401.
    for (const query of ["project_id=", "project_id=proj%20me", "project_id[toString]=x"]) {
      const rejectedToken = await fetch(`${mock.api}/sessions/me/csrf?${query}`, { headers });
      expect(rejectedToken.status).toBe(400);
      const rejectedSignOut = await fetch(`${mock.api}/sessions/me?${query}`, {
        method: "DELETE",
        headers: signOutHeaders,
      });
      expect(rejectedSignOut.status).toBe(400);
      const forgedSignOut = await fetch(`${mock.api}/sessions/me?${query}`, {
        method: "DELETE",
        headers,
      });
      expect(forgedSignOut.status).toBe(403);
      expect((await fetch(`${mock.api}/sessions/me/csrf?${query}`)).status).toBe(401);
      expect((await fetch(`${mock.api}/sessions/me?${query}`, { method: "DELETE" })).status).toBe(
        401,
      );
    }

    // The refusals ended nothing: its own project still gets its token and
    // signs it out.
    const token = await fetch(`${mock.api}/sessions/me/csrf?project_id=proj_me_signout`, {
      headers,
    });
    expect(token.status).toBe(200);
    expect(await token.json()).toEqual({ csrf_token: csrfTokenFor(cookie.split("=")[1] ?? "") });

    const signedOut = await fetch(`${mock.api}/sessions/me?project_id=proj_me_signout`, {
      method: "DELETE",
      headers: signOutHeaders,
    });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.getSetCookie().some((c) => /^zitadel_session=;/.test(c))).toBe(true);
  });

  test("GET /sessions/me answers the session with a user ref", async ({ mock }) => {
    const handoff = await signHandoffToken({ sub: "me@example.com", iss: mock.base });
    const exchange = await fetch(`${mock.api}/sessions/exchange?project_id=proj_me`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers
      .getSetCookie()
      .find((c) => c.startsWith("zitadel_session="))
      ?.split(";")[0];
    expect(cookie).toBeDefined();

    const res = await fetch(`${mock.api}/sessions/me`, { headers: { cookie: cookie ?? "" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
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

  test("POST /sessions/exchange without project_id returns 400", async ({ mock }) => {
    const handoff = await signHandoffToken({ sub: "proj_test", iss: mock.base });
    const res = await fetch(`${mock.api}/sessions/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("req.invalid");
  });

  // The server cannot tell a replayed token from one it never issued (it
  // deletes the attempt on exchange), so it refuses both, and an expired one,
  // with the same 400 (internal/api/integration_test/session_exchange_test.go).
  describe("POST /sessions/exchange refuses a handoff token it will not exchange", () => {
    const exchange = (mock: MockServer, handoffToken: string) =>
      fetch(`${mock.api}/sessions/exchange?project_id=proj_refused`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoff_token: handoffToken }),
      });
    const expectRefused = async (res: Response) => {
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.code).toBe("sess.invalid_handoff_token");
    };

    test("a replay of an exchanged token", async ({ mock }) => {
      const handoff = await signHandoffToken({ sub: "proj_refused", iss: mock.base });
      expect((await exchange(mock, handoff)).status).toBe(200);
      await expectRefused(await exchange(mock, handoff));
    });

    test("a token it never issued", async ({ mock }) => {
      await expectRefused(await exchange(mock, "handoff_never_issued"));
    });

    test("an expired token", async ({ clock, mock }) => {
      // Signed two minutes ago, so its 60-second lifetime is over.
      clock.set(Date.now() - 120_000);
      const handoff = await signHandoffToken({ sub: "proj_refused", iss: mock.base });
      clock.restore();
      await expectRefused(await exchange(mock, handoff));
    });
  });

  test("DELETE /sessions/me revokes an active session and clears the cookie", async ({ mock }) => {
    const handoff = await signHandoffToken({ sub: "proj_revoke", iss: mock.base });
    const exchange = await fetch(`${mock.api}/sessions/exchange?project_id=proj_revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoff_token: handoff }),
    });
    const setCookie = exchange.headers.getSetCookie().find((c) => c.startsWith("zitadel_session="));
    expect(setCookie).toBeDefined();
    const sessionCookie = setCookie?.split(";")[0] ?? "";

    // Session is reachable before revocation.
    const before = await fetch(`${mock.api}/sessions/me`, { headers: { cookie: sessionCookie } });
    expect(before.status).toBe(200);

    // Without the session's CSRF token, sign-out is refused and ends nothing.
    const forged = await fetch(`${mock.api}/sessions/me`, {
      method: "DELETE",
      headers: { cookie: sessionCookie },
    });
    expect(forged.status).toBe(403);
    expect(await forged.json()).toMatchObject({ code: "auth.csrf_invalid" });
    expect(forged.headers.getSetCookie()).toEqual([]);

    const revoke = await fetch(`${mock.api}/sessions/me`, {
      method: "DELETE",
      headers: {
        cookie: sessionCookie,
        "x-zitadel-csrf": csrfTokenFor(sessionCookie.split("=")[1] ?? ""),
      },
    });
    expect(revoke.status).toBe(204);
    expect(revoke.headers.getSetCookie().some((c) => /^zitadel_session=;/.test(c))).toBe(true);

    // Session is gone after revocation.
    const after = await fetch(`${mock.api}/sessions/me`, { headers: { cookie: sessionCookie } });
    expect(after.status).toBe(401);
  });

  test("derives the CSRF token exactly as the Go server does", () => {
    // Pinned on both sides (internal/api/csrf_internal_test.go TestCSRFTokenVector).
    expect(csrfTokenFor("parity-cookie")).toBe("Rstk677ADwP3NGbLdczBjYCLA5EIxtRtrm-oX7QcYh8");
  });

  test("GET /sessions/me/csrf without a session answers a 401 that is not stored", async ({
    mock,
  }) => {
    const res = await fetch(`${mock.api}/sessions/me/csrf`);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a cross-origin preflight allows the X-Zitadel-CSRF header", async ({ mock }) => {
    const res = await fetch(`${mock.api}/users?project_id=proj_test`, {
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

  test("DELETE /sessions/me without a session cookie returns 401", async ({ mock }) => {
    const res = await fetch(`${mock.api}/sessions/me`, { method: "DELETE" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  // The server's token gate refuses a cookie whose token record is gone (never
  // issued, revoked) or expired before the handler runs, so it answers 401
  // whatever project the request names.
  test("DELETE /sessions/me with an unknown session token returns 401", async ({ mock }) => {
    const res = await fetch(`${mock.api}/sessions/me`, {
      method: "DELETE",
      headers: { cookie: "zitadel_session=deadbeefdeadbeef" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("an expired session answers 401, not the project mismatch, on sign-out and the CSRF read", async ({
    clock,
    mock,
  }) => {
    const cookie = await sessionCookie(mock, "proj_me_expired");
    // Past the mock's one-hour session lifetime.
    clock.set(Date.now() + 2 * 3_600_000);
    for (const route of [
      { path: "/sessions/me", method: "DELETE" },
      { path: "/sessions/me/csrf", method: "GET" },
    ]) {
      const res = await fetch(`${mock.api}${route.path}?project_id=proj_me_other`, {
        method: route.method,
        headers: { cookie },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "auth.unauthorized" });
    }
  });

  // Like the server until 1.0.0 (ADR 077): an app on an older SDK still calls
  // the root paths.
  test.for<[string, string, number]>([
    ["POST", "/sessions/exchange?project_id=proj_root", 400],
    ["GET", "/sessions/me", 401],
    ["GET", "/sessions/me/csrf", 401],
    ["DELETE", "/sessions/me", 401],
  ])("answers %s %s at the old root path too", async ([method, path, status], { mock }) => {
    const prefixed = await fetch(`${mock.api}${path}`, { method });
    const root = await fetch(`${mock.base}${path}`, { method });

    expect(prefixed.status).toBe(status);
    expect(root.status).toBe(status);
  });

  test("GET /console/runtime.json names the project the console signs into", async ({ mock }) => {
    // Not in the OpenAPI spec: the Go server serves it from its root mux
    // (Console ADR 0004 §3). The console's mock dev loop boots on it, so the
    // path and both fields are the contract. The platform project, so a
    // console session can complete a claim (see the claim lifecycle below).
    const res = await fetch(`${mock.base}/console/runtime.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "standalone",
      console_project_id: PLATFORM_PROJECT_ID,
    });
  });

  test("POST /projects returns the spec-defined project shape", async ({ mock }) => {
    const res = await fetch(`${mock.api}/projects`, {
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
    expect(body).toMatchObject({
      name: "conformance-app",
      origins: [{ pattern: "http://localhost:3000", kind: "preview" }],
    });
  });

  test("GET /projects/:id reads a created project back", async ({ mock }) => {
    const create = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "conformance-app",
        origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await fetch(`${mock.api}/projects/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
    });
  });

  test("POST /projects/:id/origins adds a pattern and is idempotent for the same kind", async ({
    mock,
  }) => {
    const create = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "origins-app", seed_defaults: false }),
    });
    const { id } = (await create.json()) as { id: string };

    const first = await fetch(`${mock.api}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://app.example.com", kind: "primary" }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toEqual({ pattern: "https://app.example.com", kind: "primary" });
    expect(firstBody).not.toHaveProperty("check");
    expect(firstBody).not.toHaveProperty("warning");

    const again = await fetch(`${mock.api}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://app.example.com", kind: "primary" }),
    });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ pattern: "https://app.example.com", kind: "primary" });

    const conflict = await fetch(`${mock.api}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://app.example.com", kind: "preview" }),
    });
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as Record<string, unknown>;
    expect(conflictBody.code).toBe("origin.kind_conflict");
  });

  test("POST /projects/:id/origins/remove is idempotent 204", async ({ mock }) => {
    const create = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "origins-remove-app",
        origins: [{ pattern: "https://preview.example.com", kind: "preview" }],
        seed_defaults: false,
      }),
    });
    const { id } = (await create.json()) as { id: string };

    const remove = await fetch(`${mock.api}/projects/${id}/origins/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://preview.example.com" }),
    });
    expect(remove.status).toBe(204);

    const again = await fetch(`${mock.api}/projects/${id}/origins/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "https://preview.example.com" }),
    });
    expect(again.status).toBe(204);

    const get = await fetch(`${mock.api}/projects/${id}`);
    const body = await get.json();
    expect(body.origins).toEqual([]);
  });

  test("GET /projects/:id on unknown id returns spec-compliant error envelope", async ({
    mock,
  }) => {
    const res = await fetch(`${mock.api}/projects/proj-does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("proj.not_found");
    expect(typeof body.message).toBe("string");
  });

  test("POST /schemas returns 201 with the stored schema", async ({ mock }) => {
    const res = await fetch(`${mock.api}/schemas?project_id=proj_conformance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
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
    expect(body.schema).toMatchObject({ kind: "user-schema", objectType: "conformance" });
    expect(typeof (body.metadata as Record<string, unknown>).created_at).toBe("string");
  });

  test("GET /schemas/:schema_id looks up by id without project_id", async ({ mock }) => {
    const create = await fetch(`${mock.api}/schemas?project_id=proj_schema_owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
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
    const missing = await fetch(`${mock.api}/schemas/sch_does_not_exist`);
    expect(missing.status).toBe(404);

    const ownerGet = await fetch(`${mock.api}/schemas/${id}`);
    expect(ownerGet.status).toBe(200);
  });

  test("GET /schemas/:schema_id round-trips the raw uploaded document inside the envelope (no zod re-shaping)", async ({
    mock,
  }) => {
    // The real server persists the uploaded JSON Schema bytes verbatim, and
    // schema documents legitimately carry fields the request zod strips
    // (title, description). The mock must do the same,
    // serving the document under `schema` in the {id, schema, metadata}
    // envelope.
    const doc = {
      kind: "user-schema",
      metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
      objectType: "conformance",
      "x-auth-methods": { password: { enabled: true } },
      title: "CustomTitle",
      description: "Kept verbatim",
    };
    const create = await fetch(`${mock.api}/schemas?project_id=proj_schema_raw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await fetch(`${mock.api}/schemas/${id}`);
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

  test("GET /schemas lists envelopes carrying the full document", async ({ mock }) => {
    const doc = {
      kind: "user-schema",
      metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
      objectType: "conformance-list",
      "x-auth-methods": { password: { enabled: true } },
    };
    const create = await fetch(`${mock.api}/schemas?project_id=proj_schema_list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await fetch(`${mock.api}/schemas?project_id=proj_schema_list`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemas: Array<{ id: string; schema: unknown; metadata: { created_at: string } }>;
    };
    const row = body.schemas.find((entry) => entry.id === id);
    expect(row?.schema).toEqual(doc);
    expect(typeof row?.metadata.created_at).toBe("string");
  });

  test("GET /schemas adds metadata.in_use only when expanded", async ({ mock }) => {
    const create = await fetch(`${mock.base}/schemas?project_id=proj_schema_in_use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
        objectType: "conformance-in-use",
        "x-auth-methods": { password: { enabled: true } },
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const metadataOf = async (query: string) => {
      const res = await fetch(`${mock.base}/schemas?project_id=proj_schema_in_use${query}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        schemas: Array<{ id: string; metadata: Record<string, unknown> }>;
      };
      return body.schemas.find((entry) => entry.id === id)?.metadata;
    };

    expect(await metadataOf("")).not.toHaveProperty("in_use");
    // The mock keeps no users, so an expanded revision is never in use.
    expect(await metadataOf("&expand=in_use")).toMatchObject({ in_use: false });
  });

  test("GET /schemas pages with limit and next_page_token", async ({ mock }) => {
    // The consumer suites replace this handler with local MSW handlers, so
    // the mock's own slicing, token emission and continuation are only
    // proven here.
    for (let i = 0; i < 5; i += 1) {
      const create = await fetch(`${mock.api}/schemas?project_id=proj_schema_paging`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "user-schema",
          metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
          objectType: `paging-${i}`,
          "x-auth-methods": { password: { enabled: true } },
        }),
      });
      expect(create.status).toBe(201);
    }

    // The whole set fits in the default limit of 20: no token.
    const full = await fetch(`${mock.api}/schemas?project_id=proj_schema_paging`);
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
      const url = new URL(`${mock.api}/schemas`);
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
      `${mock.api}/schemas?project_id=proj_schema_paging&page_token=not-a-cursor`,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("req.invalid");

    // An out-of-range limit is rejected by the generated query schema, not
    // silently clamped.
    const oversized = await fetch(`${mock.api}/schemas?project_id=proj_schema_paging&limit=101`);
    expect(oversized.status).toBe(400);
  });

  test("POST /schemas refuses a key the user meta-schema does not allow, as the server does", async ({
    mock,
  }) => {
    const res = await fetch(`${mock.api}/schemas?project_id=proj_conformance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
        objectType: "conformance",
        "x-auth-methods": { password: { enabled: true } },
        properties: { firstName: { type: "string", minimumLength: 3 } },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; details: { issues: unknown[] } };
    expect(body.code).toBe("sch.invalid_request");
    expect(body.details.issues).toContainEqual(
      expect.objectContaining({ path: "properties.firstName", key: "minimumLength" }),
    );
  });

  test("POST /schemas with invalid kind returns spec-compliant 400 envelope", async ({ mock }) => {
    const res = await fetch(`${mock.api}/schemas?project_id=proj_conformance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "not-a-real-kind" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("sch.invalid_request");
  });

  test("POST /flow_definitions answers 201 with the flow-definition envelope", async ({ mock }) => {
    const res = await fetch(`${mock.api}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    expect(res.status).toBe(201);
  });

  test("POST /flow_definitions stores a schema id as the objectType it names", async ({ mock }) => {
    const schema = await fetch(`${mock.api}/schemas?project_id=proj_conformance_handle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "user-schema",
        metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
        objectType: "conformance-handle",
        "x-auth-methods": { passkey: { enabled: true } },
        properties: { email: { type: "string", format: "email", "x-unique": "project" } },
      }),
    });
    const { id } = (await schema.json()) as { id: string };

    const res = await fetch(`${mock.api}/flow_definitions`, {
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

  test("POST /flow_definitions rejects an invalid definition with the server's flowdef.invalid envelope", async ({
    mock,
  }) => {
    const flowDefinition = validFlowDefinitionBody();
    // A transition to a step the definition does not have — the exact class
    // of definition the real server rejects at apply time.
    flowDefinition.steps = [
      {
        name: "identifier",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", text_key: "submit", primary: true }],
        transitions: { submit: { target: "missing" } },
      },
      { name: "done", complete: "show" },
    ];
    const res = await fetch(`${mock.api}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "proj_conformance", flow_definition: flowDefinition }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      message: string;
      details: { details: string };
    };
    expect(body.code).toBe("flowdef.invalid");
    expect(body.message).toBe("flow definition: invalid");
    expect(body.details.details).toContain('targets unknown step "missing"');
  });

  test("POST /flow_definitions refuses a key the definition does not have, as the server does", async ({
    mock,
  }) => {
    const res = await fetch(`${mock.api}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance",
        flow_definition: { ...validFlowDefinitionBody(), status: "active" },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("req.invalid");
  });

  test("POST /flow_definitions with a repeated name publishes a new revision", async ({ mock }) => {
    const publish = async () => {
      const res = await fetch(`${mock.api}/flow_definitions`, {
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
      `${mock.api}/flow_definitions?project_id=proj_conformance_revisions&name=login-flow`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flow_definitions: { id: string }[] };
    expect(body.flow_definitions.map((entry) => entry.id)).toEqual([second, first]);

    const none = await fetch(
      `${mock.api}/flow_definitions?project_id=proj_conformance_revisions&name=no-such-flow`,
    );
    expect(((await none.json()) as { flow_definitions: unknown[] }).flow_definitions).toEqual([]);
  });

  test("GET /flow_definitions?revisions=latest keeps one revision per name and honours purpose", async ({
    mock,
  }) => {
    const publish = async (overrides: Record<string, unknown>) => {
      const res = await fetch(`${mock.api}/flow_definitions`, {
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
        `${mock.api}/flow_definitions?project_id=proj_conformance_latest${params}`,
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

  test("GET /flow_definitions lists the project's definitions", async ({ mock }) => {
    // Ensure at least one entry exists so the list is non-trivial.
    const create = await fetch(`${mock.api}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_list",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    const { id } = (await create.json()) as { id: string };
    // Spec: `ListFlowDefinitionsQueryParams` requires `project_id`.
    const res = await fetch(`${mock.api}/flow_definitions?project_id=proj_conformance_list`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Both read endpoints describe a flow definition the same way (#939), so
    // the row and the by-id document must be the same object.
    const row = (body as { flow_definitions: { id: string }[] }).flow_definitions.find(
      (entry) => entry.id === id,
    );
    const detail = await (await fetch(`${mock.api}/flow_definitions/${id}`)).json();
    expect(row).toEqual(detail);
  });

  test("GET /flow_definitions/:flow_definition_id reads a definition back", async ({ mock }) => {
    const create = await fetch(`${mock.api}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_get",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await fetch(`${mock.api}/flow_definitions/${id}`);
    expect(res.status).toBe(200);
  });
});

describe("api-mock claim lifecycle — init / status / complete conformance", () => {
  async function createProject(
    mock: MockServer,
    name: string,
  ): Promise<{ id: string; projectSecret: string }> {
    const res = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { id: string; project_secret: string };
    return { id: body.id, projectSecret: body.project_secret };
  }

  async function createProjectClaim(
    mock: MockServer,
    projectId: string,
    secret: string,
  ): Promise<Response> {
    return fetch(`${mock.api}/projects/${projectId}/claim/init`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
  }

  async function claimStatus(
    mock: MockServer,
    projectId: string,
    challengeId: string,
    secret: string,
  ): Promise<Response> {
    return fetch(
      `${mock.api}/projects/${projectId}/claim/status?challenge_id=${encodeURIComponent(challengeId)}`,
      { headers: { authorization: `Bearer ${secret}` } },
    );
  }

  // The claim page runs in the platform project, so an eligible claim session
  // uses PLATFORM_PROJECT_ID; passing a customer project yields an ineligible
  // one.
  const platformSessionCookie = (mock: MockServer) => sessionCookie(mock, PLATFORM_PROJECT_ID);

  /**
   * The headers a cookie-authenticated claim/complete sends: the cookie plus
   * the session's CSRF token from GET /sessions/me/csrf (ADR 053 §5). A session
   * it rejects gets an empty token, which the credential check
   * refuses first anyway.
   *
   * @param mock - The mock server the request goes to.
   */
  async function claimHeaders(mock: MockServer, cookie: string): Promise<Record<string, string>> {
    const me = await fetch(`${mock.api}/sessions/me/csrf`, { headers: { cookie } });
    const token = me.ok ? (((await me.json()) as { csrf_token?: string }).csrf_token ?? "") : "";
    return { "content-type": "application/json", cookie, "x-zitadel-csrf": token };
  }

  test("POST /projects/:id/claim/init returns 201 with a claim challenge", async ({ mock }) => {
    const project = await createProject(mock, "claim-init");
    const res = await createProjectClaim(mock, project.id, project.projectSecret);
    expect(res.status).toBe(201);
    // orval emits no `*Response` zod for a 201 body — validate structurally,
    // mirroring the POST /projects test above.
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.challenge_id).toBe("string");
    expect(() => new URL(body.claim_url as string)).not.toThrow();
    expect(new Date(body.expires_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  test("the store snapshot exposes minted challenge ids", async ({ mock }) => {
    // A test driving the mock over HTTP (the CLI suite) never sees the init
    // response body, so the snapshot is its only route to the id the
    // completion and expiry mutators take.
    const project = await createProject(mock, "claim-snapshot");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    expect(snapshotPlatformStore().claimChallengeIds).toContain(challenge_id);
  });

  test("GET /projects/:id/claim/status is pending before completion", async ({ mock }) => {
    const project = await createProject(mock, "claim-status-pending");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await claimStatus(mock, project.id, challenge_id, project.projectSecret);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = body as Record<string, unknown>;
    expect(parsed.status).toBe("pending");
    expect(parsed.team_id).toBeUndefined();
    expect(parsed.claimed_at).toBeUndefined();
    expect(parsed.dashboard_url).toBeUndefined();
  });

  test("GET /projects/:id/claim/status with a foreign project secret returns 403", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-status-owner");
    const other = await createProject(mock, "claim-status-foreign");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await claimStatus(mock, project.id, challenge_id, other.projectSecret);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("proj.permission_denied");
  });

  test("full flow: init → complete with session cookie → status completed", async ({ mock }) => {
    const project = await createProject(mock, "claim-full-flow");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie(mock);
    const complete = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(200);
    const completeBody = await complete.json();
    const completed = completeBody as Record<string, unknown>;
    expect(completed.project_id).toBe(project.id);
    expect(typeof completed.team_id).toBe("string");
    expect(typeof completed.claimed_at).toBe("string");

    const status = await claimStatus(mock, project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    const parsed = statusBody as Record<string, unknown>;
    expect(parsed.status).toBe("completed");
    expect(typeof parsed.team_id).toBe("string");
    expect(typeof parsed.claimed_at).toBe("string");
    expect(() => new URL(parsed.dashboard_url as string)).not.toThrow();
  });

  test("POST /projects/:id/claim/init returns 409 once the project is claimed", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-already-claimed");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie(mock);
    await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });

    const res = await createProjectClaim(mock, project.id, project.projectSecret);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; details: Record<string, unknown> };
    expect(body.code).toBe("proj.already_claimed");
    expect(typeof body.details.team_id).toBe("string");
    expect(() => new URL(body.details.dashboard_url as string)).not.toThrow();
  });

  test("an expired challenge makes status and complete return 410", async ({ mock }) => {
    const project = await createProject(mock, "claim-expired");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    expireClaimChallenge(challenge_id);

    const status = await claimStatus(mock, project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(410);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.code).toBe("proj.claim_expired");

    const cookie = await platformSessionCookie(mock);
    const complete = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(410);
    const completeBody = (await complete.json()) as Record<string, unknown>;
    expect(completeBody.code).toBe("proj.claim_expired");
  });

  test("a closed claim window makes init and complete return 410 claim_window_expired", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-window-expired");
    // Mint the challenge while the window is open, then close it: complete
    // must refuse even a live challenge once the project is too old.
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    expireClaimWindow(project.id);

    const reinit = await createProjectClaim(mock, project.id, project.projectSecret);
    expect(reinit.status).toBe(410);
    const reinitBody = (await reinit.json()) as Record<string, unknown>;
    expect(reinitBody.code).toBe("proj.claim_window_expired");

    // The poll must learn the same final refusal, not the retryable
    // challenge expiry, so a CLI mid-poll stops suggesting a fresh claim.
    const status = await claimStatus(mock, project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(410);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.code).toBe("proj.claim_window_expired");

    const cookie = await platformSessionCookie(mock);
    const complete = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(410);
    const completeBody = (await complete.json()) as Record<string, unknown>;
    expect(completeBody.code).toBe("proj.claim_window_expired");

    // Both expired at once: the final window refusal must win over the
    // retryable challenge expiry, on status and complete alike.
    expireClaimChallenge(challenge_id);
    const bothStatus = await claimStatus(mock, project.id, challenge_id, project.projectSecret);
    expect(bothStatus.status).toBe(410);
    expect(((await bothStatus.json()) as Record<string, unknown>).code).toBe(
      "proj.claim_window_expired",
    );
    const bothComplete = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(bothComplete.status).toBe(410);
    expect(((await bothComplete.json()) as Record<string, unknown>).code).toBe(
      "proj.claim_window_expired",
    );
  });

  test("POST /projects/:id/claim/complete without a session cookie returns 401", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-complete-no-cookie");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("POST /projects/:id/claim/complete without the CSRF token returns 403", async ({ mock }) => {
    const project = await createProject(mock, "claim-complete-no-csrf");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie(mock);
    const res = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.csrf_invalid");
  });

  test("POST /projects/:id/claim/complete with an unknown challenge returns 404", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-complete-unknown");
    const cookie = await platformSessionCookie(mock);
    const res = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id: "ch_doesnotexist" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /projects/:id/claim/complete without challenge_id returns 400", async ({ mock }) => {
    const project = await createProject(mock, "claim-complete-missing-id");
    const cookie = await platformSessionCookie(mock);
    const res = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /projects/:id/claim/init with another project's secret returns 404", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-init-owner");
    const other = await createProject(mock, "claim-init-foreign");
    const res = await createProjectClaim(mock, project.id, other.projectSecret);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("proj.not_found");
  });

  test("GET /projects/:id/claim/status without a bearer token returns 401", async ({ mock }) => {
    const project = await createProject(mock, "claim-status-no-bearer");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const res = await fetch(
      `${mock.api}/projects/${project.id}/claim/status?challenge_id=${encodeURIComponent(challenge_id)}`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("POST /projects/:id/claim/complete with a customer-project session returns 401", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-complete-ineligible");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    // A session for the customer project, not the platform project, must not
    // be able to claim (ADR 046 §2).
    const cookie = await sessionCookie(mock, project.id);
    const res = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("auth.unauthorized");
  });

  test("POST /projects/:id/claim/complete on a mismatched project returns 404", async ({
    mock,
  }) => {
    const project = await createProject(mock, "claim-complete-path-a");
    const other = await createProject(mock, "claim-complete-path-b");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie(mock);
    const res = await fetch(`${mock.api}/projects/${other.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(res.status).toBe(404);
  });

  test("a claim challenge is single-use: a second completion returns 409", async ({ mock }) => {
    const project = await createProject(mock, "claim-single-use");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie(mock);
    const url = `${mock.api}/projects/${project.id}/claim/complete`;
    const body = JSON.stringify({ challenge_id });
    const headers = await claimHeaders(mock, cookie);

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
  test("a completed claim stays completed on status past challenge expiry", async ({ mock }) => {
    const project = await createProject(mock, "claim-completed-expired");
    const init = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie(mock);
    const complete = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(200);

    expireClaimChallenge(challenge_id);
    const status = await claimStatus(mock, project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.status).toBe("completed");
    expect(typeof statusBody.team_id).toBe("string");
  });

  // The grant, not the polled challenge, is the truth: a poll on a pending
  // challenge whose project was claimed through ANOTHER challenge reports
  // completed with the owning team, even once the claim window has closed —
  // never a false "can no longer be claimed" verdict.
  test("a pending challenge on a project claimed elsewhere reports completed", async ({ mock }) => {
    const project = await createProject(mock, "claim-cross-challenge-status");
    const first = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id: polled } = (await first.json()) as { challenge_id: string };
    const second = await createProjectClaim(mock, project.id, project.projectSecret);
    const { challenge_id: winner } = (await second.json()) as { challenge_id: string };

    const cookie = await platformSessionCookie(mock);
    const complete = await fetch(`${mock.api}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: await claimHeaders(mock, cookie),
      body: JSON.stringify({ challenge_id: winner }),
    });
    expect(complete.status).toBe(200);
    expireClaimWindow(project.id);

    const status = await claimStatus(mock, project.id, polled, project.projectSecret);
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

  async function newProject(mock: MockServer, name: string): Promise<string> {
    const res = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  async function putIdp(mock: MockServer, projectId: string, idp: object): Promise<Response> {
    return fetch(`${mock.base}/idps?project_id=${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idp }),
    });
  }

  test("creates a connection and answers the generated response shape", async ({ mock }) => {
    const projectId = await newProject(mock, "idp-create");

    const res = await putIdp(mock, projectId, connection());

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toBe("google");
    expect(String(body.id)).toMatch(/^idp_/);
    expect(String(body.revision_id)).toMatch(/^idprev_/);
  });

  test("a second write of the same slug revises it under one id", async ({ mock }) => {
    // This is what keeps `apply` idempotent: the schema and every flow step
    // reference the slug, so a second connection for it would orphan them.
    const projectId = await newProject(mock, "idp-revise");
    const first = (await (await putIdp(mock, projectId, connection())).json()) as Record<
      string,
      unknown
    >;

    const second = await putIdp(mock, projectId, connection({ display_name: "Google Workspace" }));

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

    test.for<[string, object, string[]]>([
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
      async ([_case, over, missing], { mock }) => {
        const projectId = await newProject(mock, "idp-endpoints-partial");

        const res = await putIdp(mock, projectId, withOidc(over));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          code: "idp.endpoints_partial",
          message: "identity provider connection: the endpoints are partially set",
          details: { details: { missing } },
        });
      },
    );

    test("refuses a revision too, before the slug is looked up", async ({ mock }) => {
      const projectId = await newProject(mock, "idp-endpoints-partial-revise");
      expect((await putIdp(mock, projectId, connection())).status).toBe(201);

      const res = await putIdp(mock, projectId, withOidc({ jwks_uri: endpoints.jwks_uri }));

      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("idp.endpoints_partial");
    });

    test.for<[string, object]>([
      ["every endpoint", endpoints],
      [
        "every endpoint but userinfo under id_token_mapping",
        { ...endpoints, userinfo_endpoint: undefined, id_token_mapping: true },
      ],
    ])("accepts %s", async ([_case, over], { mock }) => {
      const projectId = await newProject(mock, "idp-endpoints-full");

      expect((await putIdp(mock, projectId, withOidc(over))).status).toBe(201);
    });
  });

  test("reads one back by id, and 404s an id the project does not own", async ({ mock }) => {
    const mine = await newProject(mock, "idp-read-mine");
    const other = await newProject(mock, "idp-read-other");
    const created = (await (await putIdp(mock, mine, connection())).json()) as { id: string };

    const ok = await fetch(`${mock.base}/idps/${created.id}?project_id=${mine}`);
    expect(ok.status).toBe(200);

    const foreign = await fetch(`${mock.base}/idps/${created.id}?project_id=${other}`);
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { code: string }).code).toBe("idp.not_found");
  });

  test("lists only the project's own connections", async ({ mock }) => {
    const mine = await newProject(mock, "idp-list-mine");
    const other = await newProject(mock, "idp-list-other");
    await putIdp(mock, mine, connection());
    await putIdp(mock, other, connection({ slug: "github", template: "github" }));

    const res = await fetch(`${mock.base}/idps/query?project_id=${mine}`, { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { idps: { slug: string }[] };
    expect(body.idps.map((i) => i.slug)).toEqual(["google"]);
  });

  test("stores a variable and reads it back", async ({ mock }) => {
    const projectId = await newProject(mock, "vars-plain");

    const patch = await fetch(`${mock.base}/variables?project_id=${projectId}`, {
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

    const res = await fetch(`${mock.base}/variables?project_id=${projectId}`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.GOOGLE_CLIENT_ID).toEqual({
      primary: "824.apps.googleusercontent.com",
      preview: "824.apps.googleusercontent.com",
    });
  });

  test("reads and deletes one variable by name", async ({ mock }) => {
    const projectId = await newProject(mock, "vars-by-name");
    await fetch(`${mock.base}/variables?project_id=${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ SESSION_TTL: { value: 900, secret: false } }),
    });

    const read = await fetch(`${mock.base}/variables/SESSION_TTL?project_id=${projectId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ primary: 900, preview: 900 });

    const removed = await fetch(`${mock.base}/variables/SESSION_TTL?project_id=${projectId}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect((await fetch(`${mock.base}/variables/SESSION_TTL?project_id=${projectId}`)).status).toBe(
      404,
    );
  });

  test("answers var.not_found for a name the project does not hold", async ({ mock }) => {
    const projectId = await newProject(mock, "vars-missing");

    const res = await fetch(`${mock.base}/variables/ABSENT?project_id=${projectId}`);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code?: string }).code).toBe("var.not_found");
  });

  test.for<[string, string]>([
    ["a name the schema rejects", "bad-name"],
    ["a name past the length cap", "N".repeat(256)],
  ])("refuses %s rather than reporting it missing", async ([_label, name], { mock }) => {
    // variable-name.yaml allows word characters up to 255, so an unusable name
    // is a bad request: answering `var.not_found` would tell a caller the name
    // is free when it could never be used.
    const projectId = await newProject(mock, "vars-invalid-name");

    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${mock.base}/variables/${name}?project_id=${projectId}`, { method });
      expect(res.status, `${method} ${name}`).toBe(400);
    }
  });

  test("never reads a secret's value back", async ({ mock }) => {
    // ADR 062 §7: a secret can be replaced but not read. Returning the value
    // here would make the encryption it stands for pointless.
    const projectId = await newProject(mock, "vars-secret");
    await fetch(`${mock.base}/variables?project_id=${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ GOOGLE_CLIENT_SECRET: { value: "GOCSPX-real", secret: true } }),
    });

    const body = (await (
      await fetch(`${mock.base}/variables?project_id=${projectId}`)
    ).json()) as Record<string, unknown>;

    expect(body.GOOGLE_CLIENT_SECRET).toEqual({ primary: { secret: true } });
    expect(JSON.stringify(body)).not.toContain("GOCSPX-real");
  });

  test("patches rather than replaces, and null removes a name", async ({ mock }) => {
    const projectId = await newProject(mock, "vars-patch");
    const url = `${mock.base}/variables?project_id=${projectId}`;
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

  test("keeps one project's variables out of another's", async ({ mock }) => {
    const mine = await newProject(mock, "vars-mine");
    const other = await newProject(mock, "vars-other");
    await fetch(`${mock.base}/variables?project_id=${mine}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MINE: { value: "x", secret: false } }),
    });

    const body = (await (
      await fetch(`${mock.base}/variables?project_id=${other}`)
    ).json()) as object;

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

  async function newProject(mock: MockServer, name: string): Promise<string> {
    const res = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  const putIdp = (mock: MockServer, projectId: string, idp: object) =>
    fetch(`${mock.base}/idps?project_id=${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idp }),
    });

  const queryIdps = (mock: MockServer, projectId: string, body: object) =>
    fetch(`${mock.base}/idps/query?project_id=${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("refuses a revision that changes the connection's identity", async ({ mock }) => {
    // protocol, subject_claim and the authority decide which provider account a
    // stored subject belongs to, so changing one repoints existing identities
    // rather than reconfiguring them.
    const projectId = await newProject(mock, "idp-immutable");
    await putIdp(mock, projectId, base);

    const repointed = await putIdp(mock, projectId, {
      ...base,
      oidc: { ...base.oidc, issuer: "https://login.microsoftonline.com/common/v2.0" },
    });

    expect(repointed.status).toBe(400);
    expect(await repointed.json()).toMatchObject({
      code: "idp.field_immutable",
      details: { details: { fields: ["oidc.issuer"] } },
    });

    // An absent subject_claim reads as `sub`, so dropping an explicit one is no
    // change, while naming another claim is.
    const implicitSub = await putIdp(mock, projectId, { ...base, subject_claim: undefined });

    expect(implicitSub.status).toBe(200);

    const otherClaim = await putIdp(mock, projectId, { ...base, subject_claim: "oid" });

    expect(otherClaim.status).toBe(400);
    expect(await otherClaim.json()).toMatchObject({
      details: { details: { fields: ["subject_claim"] } },
    });
  });

  test("accepts a revision that changes something mutable", async ({ mock }) => {
    const projectId = await newProject(mock, "idp-mutable");
    await putIdp(mock, projectId, base);

    const revised = await putIdp(mock, projectId, {
      ...base,
      oidc: { ...base.oidc, scopes: ["openid", "profile"] },
    });

    expect(revised.status).toBe(200);
  });

  test("applies a slug filter instead of returning every connection", async ({ mock }) => {
    const projectId = await newProject(mock, "idp-filter");
    await putIdp(mock, projectId, base);
    await putIdp(mock, projectId, { ...base, slug: "acme", template: "oidc-generic" });

    const res = await queryIdps(mock, projectId, {
      filter: [{ field: "slug", operation: "equals", value: "acme" }],
    });

    const body = (await res.json()) as { idps: { slug: string }[] };
    expect(body.idps.map((i) => i.slug)).toEqual(["acme"]);
  });

  test("honours limit and sort direction", async ({ mock }) => {
    const projectId = await newProject(mock, "idp-sort");
    await putIdp(mock, projectId, base);
    await putIdp(mock, projectId, { ...base, slug: "acme", template: "oidc-generic" });

    const res = await queryIdps(mock, projectId, {
      limit: 1,
      sorting: { field: "slug", direction: "desc" },
    });

    const body = (await res.json()) as { idps: { slug: string }[] };
    expect(body.idps.map((i) => i.slug)).toEqual(["google"]);
  });

  test("rejects a malformed query body rather than ignoring it", async ({ mock }) => {
    const projectId = await newProject(mock, "idp-badquery");

    const res = await queryIdps(mock, projectId, { limit: "lots" });

    expect(res.status).toBe(400);
  });

  test("keeps each kind's value separate", async ({ mock }) => {
    // Nothing falls back between kinds: a preview value is its own, and a
    // removal naming a kind leaves the other kind's value.
    const projectId = await newProject(mock, "vars-kinds");
    const url = (kind?: string) =>
      `${mock.base}/variables?project_id=${projectId}${kind === undefined ? "" : `&kind=${kind}`}`;
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

    const removed = await fetch(
      `${mock.base}/variables/SHARED?project_id=${projectId}&kind=preview`,
      {
        method: "DELETE",
      },
    );
    expect(removed.status).toBe(204);
    expect(
      (await fetch(`${mock.base}/variables/SHARED?project_id=${projectId}&kind=preview`)).status,
    ).toBe(404);
    expect(await (await fetch(url())).json()).toEqual({ SHARED: { primary: "prod" } });
  });

  test("writes a secret naming no kind for primary only, removing the preview value", async ({
    mock,
  }) => {
    const projectId = await newProject(mock, "vars-secret-kind");
    const url = `${mock.base}/variables?project_id=${projectId}`;
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

  test("answers not found for the variables of a deployment the project does not hold", async ({
    mock,
  }) => {
    const projectId = await newProject(mock, "vars-deployment");

    const res = await fetch(
      `${mock.base}/deployments/dep_01KX5N7C9D2E7F0N9WD3P2E4YM6/variables?project_id=${projectId}`,
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code?: string }).code).toBe("dep.not_found");
  });

  test("reads back what the write did not touch", async ({ mock }) => {
    const projectId = await newProject(mock, "vars-readback");
    const url = `${mock.base}/variables?project_id=${projectId}`;
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
describe("api-mock releases and deployments", () => {
  async function newProject(
    mock: MockServer,
    name: string,
  ): Promise<{ id: string; secret: string }> {
    const res = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { id: string; project_secret: string };
    return { id: body.id, secret: body.project_secret };
  }

  const addPrimary = (mock: MockServer, id: string, secret: string, pattern: string) =>
    fetch(`${mock.api}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ pattern, kind: "primary" }),
    });

  const addPreview = (mock: MockServer, id: string, secret: string, pattern: string) =>
    fetch(`${mock.base}/projects/${id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ pattern, kind: "preview" }),
    });

  const rel1 = { pointers: [{ kind: "schema", revision_id: "sch_a" }] };
  const rel2 = { pointers: [{ kind: "schema", revision_id: "sch_b" }] };

  const createRelease = (mock: MockServer, id: string, secret: string, body: object) =>
    fetch(`${mock.base}/releases?project_id=${id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });

  const createDeployment = (mock: MockServer, id: string, secret: string, body: object) =>
    fetch(`${mock.base}/deployments?project_id=${id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });

  /**
   * The primary origin the projects of the revoke, guard and status tests list.
   */
  const PRIMARY_URL = "https://app.acme.com";

  /**
   * The preview pattern the projects of the revoke and status tests list.
   */
  const PREVIEW_PATTERN = "https://*-acmeinc.vercel.app";

  /**
   * Builds a release of the project as its operator.
   *
   * @param mock - The mock server the request goes to.
   * @param project - The project's id and secret.
   * @param bundle - What the release pins.
   * @returns The release, as the platform answered the create.
   */
  async function released(
    mock: MockServer,
    project: { id: string; secret: string },
    bundle: object,
  ) {
    const created = await createRelease(mock, project.id, project.secret, bundle);

    return (await created.json()) as { id: string };
  }

  /**
   * Deploys a release of the project as its operator.
   *
   * @param mock - The mock server the request goes to.
   * @param project - The project's id and secret.
   * @param body - What to deploy and where, as the API takes it.
   * @returns The deployment, as the platform answered the create.
   */
  async function deployed(mock: MockServer, project: { id: string; secret: string }, body: object) {
    const created = await createDeployment(mock, project.id, project.secret, body);

    return (await created.json()) as { id: string };
  }

  /**
   * Removes a live preview as the project's operator.
   *
   * @param mock - The mock server the request goes to.
   * @param project - The project's id and secret.
   * @param origin - The preview URL to remove.
   * @returns The platform's answer.
   */
  function removeLivePreview(
    mock: MockServer,
    project: { id: string; secret: string },
    origin: string,
  ): Promise<Response> {
    return fetch(`${mock.base}/projects/${project.id}/previews/remove`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ origin }),
    });
  }

  test("freezes the variables of the deployment's kind, untouched by later writes", async ({
    mock,
  }) => {
    const project = await newProject(mock, "deployment-frozen-variables");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const variables = `${mock.base}/variables?project_id=${project.id}`;
    const write = (kind: string, payload: object) =>
      fetch(`${variables}&kind=${kind}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify(payload),
      });
    await write("primary", { HOST: "app.acme.com", TOKEN: { value: "s3cr3t", secret: true } });
    await write("preview", { HOST: "preview.acme.com" });
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const deployment = (await (
      await createDeployment(mock, project.id, project.secret, {
        release_id: release.id,
        targets: "primary",
      })
    ).json()) as { id: string };
    await write("primary", { HOST: "changed.acme.com" });

    const res = await fetch(
      `${mock.base}/deployments/${deployment.id}/variables?project_id=${project.id}`,
      { headers: { authorization: `Bearer ${project.secret}` } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ HOST: "app.acme.com", TOKEN: { secret: true } });
  });

  test("reuses the restored deployment's frozen variables on rollback", async ({ mock }) => {
    const project = await newProject(mock, "rollback-frozen-variables");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const write = (payload: object) =>
      fetch(`${mock.base}/variables?project_id=${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify(payload),
      });
    const deploy = async (body: object) => {
      const release = (await (
        await createRelease(mock, project.id, project.secret, body)
      ).json()) as {
        id: string;
      };
      return (await (
        await createDeployment(mock, project.id, project.secret, {
          release_id: release.id,
          targets: "primary",
        })
      ).json()) as { id: string };
    };
    await write({ HOST: "first.acme.com" });
    const first = await deploy(rel1);
    await write({ HOST: "second.acme.com" });
    await deploy(rel2);
    const rolledBack = (await (
      await fetch(`${mock.base}/deployments/${first.id}/rollback?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({}),
      })
    ).json()) as { id: string };

    const res = await fetch(
      `${mock.base}/deployments/${rolledBack.id}/variables?project_id=${project.id}`,
      { headers: { authorization: `Bearer ${project.secret}` } },
    );

    expect(await res.json()).toEqual({ HOST: "first.acme.com" });
  });

  test("refuses a bundled flow definition with a key the definition does not have", async ({
    mock,
  }) => {
    const project = await newProject(mock, "release-build-flow-key");
    const res = await fetch(`${mock.base}/releases/build?project_id=${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({
        bundle: { flow_definitions: [{ ...validFlowDefinitionBody(), status: "active" }] },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("req.invalid");
  });

  test("builds a release whose bundle carries a connection, resolving it by slug", async ({
    mock,
  }) => {
    const project = await newProject(mock, "release-build-idps");
    const connection = (secret: string) => ({
      slug: "google",
      protocol: "oidc",
      template: "google",
      display_name: "Google",
      oidc: {
        issuer: "https://accounts.google.com",
        client_id: "111.apps.googleusercontent.com",
        client_secret: secret,
        scopes: ["openid"],
      },
    });
    const build = (body: object) =>
      fetch(`${mock.base}/releases/build?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify(body),
      });

    const first = await build({
      bundle: { schemas: [], flow_definitions: [], idps: [connection("${{ A }}")] },
    });

    expect(first.status).toBe(201);
    const pointers = ((await first.json()) as { pointers: { kind: string; handle: string }[] })
      .pointers;
    expect(pointers).toContainEqual(expect.objectContaining({ kind: "idp", handle: "google" }));

    // The connection is the project's now, created by the build rather than by
    // a separate write before it.
    const listed = (await (
      await fetch(`${mock.base}/idps/query?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({}),
      })
    ).json()) as { idps: { slug: string }[] };
    expect(listed.idps.map((idp) => idp.slug)).toEqual(["google"]);

    // A changed document revises the same connection, so the slug keeps
    // pointing at it rather than a second one appearing.
    await build({
      bundle: { schemas: [], flow_definitions: [], idps: [connection("${{ B }}")] },
    });
    const again = (await (
      await fetch(`${mock.base}/idps/query?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({}),
      })
    ).json()) as { idps: { slug: string }[] };
    expect(again.idps).toHaveLength(1);
  });

  test("refuses a build that would change a connection's fixed field", async ({ mock }) => {
    const project = await newProject(mock, "release-build-idp-immutable");
    const connection = (issuer: string) => ({
      slug: "google",
      protocol: "oidc",
      template: "google",
      display_name: "Google",
      oidc: {
        issuer,
        client_id: "111.apps.googleusercontent.com",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
        scopes: ["openid"],
      },
    });
    const build = (body: object) =>
      fetch(`${mock.base}/releases/build?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify(body),
      });
    await build({
      bundle: {
        schemas: [],
        flow_definitions: [],
        idps: [connection("https://accounts.google.com")],
      },
    });

    const res = await build({
      bundle: {
        schemas: [],
        flow_definitions: [],
        idps: [connection("https://login.microsoftonline.com")],
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "rel.invalid",
      details: {
        resources: [
          {
            kind: "idp",
            handle: "google",
            code: "idp.field_immutable",
            details: { details: { fields: ["oidc.issuer"] } },
          },
        ],
      },
    });
  });

  test("evaluates a password policy as a password set would, storing nothing", async ({ mock }) => {
    const project = await newProject(mock, "policy-evaluate");
    const evaluate = (body: object) =>
      fetch(`${mock.base}/policies/evaluate?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({ operation: "auth.factor.password.set", ...body }),
      });
    const decision = async (body: object) => {
      const res = await evaluate(body);
      expect(res.status).toBe(200);
      return res.json();
    };

    expect(
      await decision({ config: { min_length: 12 }, input: { password: "a-long-enough-one" } }),
    ).toEqual({
      allowed: true,
    });
    expect(await decision({ config: { min_length: 12 }, input: { password: "short1" } })).toEqual({
      allowed: false,
      code: "user.password_policy_violation",
      violations: { min_length: 12 },
    });
    // 13 code points, 14 bytes.
    expect(
      await decision({ config: { min_length: 14 }, input: { password: "Passwört12345" } }),
    ).toMatchObject({
      violations: { min_length: 14 },
    });
    expect(await decision({ config: {}, input: { password: "" } })).toEqual({
      allowed: false,
      code: "user.password_empty",
    });
    expect(await decision({ config: {}, input: { password: "a".repeat(65) } })).toMatchObject({
      violations: { max_length: 64 },
    });
    expect(
      await decision({
        config: { history_depth: 2 },
        input: { password: "reused" },
        facts: { history_matches: [false, true] },
      }),
    ).toMatchObject({ violations: { history_depth: 2 } });
    expect(
      await decision({
        config: { history_depth: 2 },
        input: { password: "reused" },
        facts: { self_service: false, history_matches: [true] },
      }),
    ).toEqual({ allowed: true });

    const contradicting = await evaluate({
      config: { min_length: 20, max_length: 10 },
      input: { password: "x" },
    });
    expect(contradicting.status).toBe(400);
    expect(((await contradicting.json()) as { code: string }).code).toBe("pol.invalid");
    for (const malformed of [
      { config: { min_lenght: 12 }, input: { password: "x" } },
      { config: {}, input: { password: "x", passwd: "x" } },
      { config: { history_depth: 2 }, input: { password: "x" }, facts: { history_match: [true] } },
      { config: {}, input: { password: "a".repeat(4097) } },
      {
        config: {},
        input: { password: "x" },
        facts: { history_matches: [false, false, false, false, true] },
      },
    ]) {
      const res = await evaluate(malformed);
      expect(res.status, JSON.stringify(malformed)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("req.invalid");
    }

    const listed = (await (
      await fetch(`${mock.base}/policies?project_id=${project.id}`, {
        headers: { authorization: `Bearer ${project.secret}` },
      })
    ).json()) as { policies: unknown[] };
    expect(listed.policies).toEqual([]);
  });

  test("builds a release whose bundle carries a policy, revising it only when it changes", async ({
    mock,
  }) => {
    const project = await newProject(mock, "release-build-policies");
    const policy = (min_length: number) => ({
      operation: "auth.factor.password.set",
      config: { min_length },
    });
    const build = (body: object) =>
      fetch(`${mock.base}/releases/build?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify(body),
      });
    const listed = async () =>
      (
        (await (
          await fetch(`${mock.base}/policies?project_id=${project.id}`, {
            headers: { authorization: `Bearer ${project.secret}` },
          })
        ).json()) as { policies: { id: string; revision_id: string; config: object }[] }
      ).policies;

    const first = await build({ bundle: { policies: [policy(12)] } });
    expect(first.status).toBe(201);
    const pointers = ((await first.json()) as { pointers: { kind: string; handle: string }[] })
      .pointers;
    expect(pointers).toContainEqual(
      expect.objectContaining({ kind: "policy", handle: "auth.factor.password.set" }),
    );
    const [published] = await listed();
    expect(published?.config).toEqual({ min_length: 12 });

    await build({ bundle: { policies: [policy(14)] } });
    const [revised] = await listed();
    expect(revised?.id).toBe(published?.id);
    expect(revised?.revision_id).not.toBe(published?.revision_id);
    expect(revised?.config).toEqual({ min_length: 14 });

    // Going back adds a revision, as the service does, so the earlier config
    // applies again and the build is a new release rather than the first one.
    const back = await build({ bundle: { policies: [policy(12)] } });
    expect(back.status).toBe(201);
    const [again] = await listed();
    expect(again?.config).toEqual({ min_length: 12 });
    expect(again?.revision_id).not.toBe(published?.revision_id);
  });

  test("refuses a bundle whose policy breaks its template's rule, or carries one twice", async ({
    mock,
  }) => {
    const project = await newProject(mock, "release-build-policy-invalid");
    const build = (body: object) =>
      fetch(`${mock.base}/releases/build?project_id=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify(body),
      });

    const contradicting = await build({
      bundle: {
        policies: [
          { operation: "auth.factor.password.set", config: { min_length: 20, max_length: 10 } },
        ],
      },
    });
    expect(contradicting.status).toBe(400);
    const refused = (await contradicting.json()) as {
      code: string;
      details: { resources: { kind: string; code: string }[] };
    };
    expect(refused.code).toBe("rel.invalid");
    expect(refused.details.resources).toEqual([
      expect.objectContaining({ kind: "policy", code: "pol.invalid" }),
    ]);

    const once = { operation: "auth.factor.password.set", config: {} };
    const twice = await build({ bundle: { policies: [once, once] } });
    expect(twice.status).toBe(400);
    expect(
      ((await twice.json()) as { details: { resources: unknown[] } }).details.resources,
    ).toHaveLength(2);
  });

  test("creates a release and dedupes a resubmission on content", async ({ mock }) => {
    const project = await newProject(mock, "release-create");

    const first = await createRelease(mock, project.id, project.secret, {
      ...rel1,
      message: "one",
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string; content_hash: string; revoked_at: null };
    expect(created.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(created.revoked_at).toBeNull();

    const again = await createRelease(mock, project.id, project.secret, {
      ...rel1,
      message: "two",
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(created.id);
  });

  test("filters the release list by content hash", async ({ mock }) => {
    const project = await newProject(mock, "release-filter");
    const created = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      content_hash: string;
    };

    const match = await fetch(
      `${mock.base}/releases?project_id=${project.id}&content_hash=${encodeURIComponent(created.content_hash)}`,
    );
    expect(((await match.json()) as { releases: unknown[] }).releases).toHaveLength(1);

    const miss = await fetch(
      `${mock.base}/releases?project_id=${project.id}&content_hash=sha256:${"0".repeat(64)}`,
    );
    expect(((await miss.json()) as { releases: unknown[] }).releases).toHaveLength(0);
  });

  test("deploys a release to every primary origin and is idempotent", async ({ mock }) => {
    const project = await newProject(mock, "deploy-primary");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };

    const first = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: "primary",
    });
    expect(first.status).toBe(201);
    const deployment = (await first.json()) as {
      targets: { origin: string }[];
      release_id: string;
    };
    expect(deployment.targets).toEqual([{ origin: "https://app.acme.com" }]);

    const again = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: "primary",
    });
    expect(again.status).toBe(200);
  });

  test("rejects primary with no primary origin, and an unknown origin", async ({ mock }) => {
    const project = await newProject(mock, "deploy-no-primary");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };

    const noPrimary = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: "primary",
    });
    expect(noPrimary.status).toBe(400);
    expect(((await noPrimary.json()) as { code: string }).code).toBe("dep.invalid");

    const unknown = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: ["https://not-allowed.example.com"],
    });
    expect(unknown.status).toBe(403);
    expect(((await unknown.json()) as { code: string }).code).toBe("proj.origin_not_allowed");
  });

  test("carries the deployment kind, and turns a replaced one inactive", async ({ mock }) => {
    const project = await newProject(mock, "deploy-kind-status");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const first = (await (await createRelease(mock, project.id, project.secret, rel1)).json()) as {
      id: string;
    };
    const second = (await (await createRelease(mock, project.id, project.secret, rel2)).json()) as {
      id: string;
    };

    const live = await createDeployment(mock, project.id, project.secret, {
      release_id: first.id,
      targets: "primary",
    });
    expect(await live.json()).toMatchObject({ kind: "primary", status: "live" });

    await createDeployment(mock, project.id, project.secret, {
      release_id: second.id,
      targets: "primary",
    });

    const history = (await (
      await fetch(`${mock.base}/deployments?project_id=${project.id}`, {
        headers: { authorization: `Bearer ${project.secret}` },
      })
    ).json()) as { deployments: { release_id: string; status: string }[] };
    expect(history.deployments.find((entry) => entry.release_id === first.id)?.status).toBe(
      "inactive",
    );
  });

  test("refuses a primary origin named one by one", async ({ mock }) => {
    const project = await newProject(mock, "deploy-exact-primary");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };

    const res = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: ["https://app.acme.com"],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "dep.invalid",
      message: "deployment: deploy to primary origins with the primary target",
    });
  });

  test("refuses a rollback whose expected deployment is no longer the newest", async ({ mock }) => {
    const project = await newProject(mock, "deploy-rollback-guard");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const first = (await (await createRelease(mock, project.id, project.secret, rel1)).json()) as {
      id: string;
    };
    const firstDeploy = (await (
      await createDeployment(mock, project.id, project.secret, {
        release_id: first.id,
        targets: "primary",
      })
    ).json()) as { id: string };
    const second = (await (await createRelease(mock, project.id, project.secret, rel2)).json()) as {
      id: string;
    };
    await createDeployment(mock, project.id, project.secret, {
      release_id: second.id,
      targets: "primary",
    });

    const rollback = await fetch(
      `${mock.base}/deployments/${firstDeploy.id}/rollback?project_id=${project.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({ expected_deployment_id: firstDeploy.id }),
      },
    );

    expect(rollback.status).toBe(409);
    expect(((await rollback.json()) as { code: string }).code).toBe("dep.conflict");
  });

  test("refuses a deploy that names an expected deployment where nothing is deployed", async ({
    mock,
  }) => {
    const project = await newProject(mock, "deploy-guard-nothing-deployed");
    await addPrimary(mock, project.id, project.secret, PRIMARY_URL);
    const release = await released(mock, project, rel1);

    const refused = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: "primary",
      expected_deployment_id: "dep_none",
    });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "dep.conflict",
      details: { deployment: null },
    });
  });

  test("names a removed preview as the live deployment a new one to its URL replaces", async ({
    mock,
  }) => {
    const previewUrl = "https://x-acmeinc.vercel.app";
    const project = await newProject(mock, "deploy-guard-removed-preview");
    await addPrimary(mock, project.id, project.secret, PRIMARY_URL);
    await addPreview(mock, project.id, project.secret, PREVIEW_PATTERN);
    const release = await released(mock, project, rel1);
    const primary = await deployed(mock, project, { release_id: release.id, targets: "primary" });
    const preview = await deployed(mock, project, {
      release_id: release.id,
      targets: [previewUrl],
      ttl: "PT1H",
    });
    await removeLivePreview(mock, project, previewUrl);

    const refused = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: [previewUrl],
      expected_deployment_id: primary.id,
    });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "dep.conflict",
      details: { deployment: { id: preview.id, status: "live" } },
    });
  });

  test("deploys by digest the release of this project, not another's with the same digest", async ({
    mock,
  }) => {
    const first = await newProject(mock, "deploy-digest-a");
    const second = await newProject(mock, "deploy-digest-b");
    await addPrimary(mock, second.id, second.secret, "https://app.acme.com");
    await createRelease(mock, first.id, first.secret, rel1);
    const own = (await (await createRelease(mock, second.id, second.secret, rel1)).json()) as {
      content_hash: string;
    };

    const deployed = await createDeployment(mock, second.id, second.secret, {
      content_hash: own.content_hash,
      targets: "primary",
    });

    expect(deployed.status).toBe(201);
  });

  test("writes a new preview deployment for a release the URL already serves", async ({ mock }) => {
    const project = await newProject(mock, "deploy-preview-renewal");
    await fetch(`${mock.api}/projects/${project.id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ pattern: "https://*-acme.vercel.app", kind: "preview" }),
    });
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const body = { release_id: release.id, targets: ["https://x-acme.vercel.app"], ttl: "PT1H" };
    await createDeployment(mock, project.id, project.secret, body);

    const renewed = await createDeployment(mock, project.id, project.secret, {
      ...body,
      ttl: "P30D",
    });

    expect(renewed.status).toBe(201);
  });

  test("gives a preview deployment without a ttl the project's default expiry", async ({
    mock,
  }) => {
    const project = await newProject(mock, "deploy-preview-default-ttl");
    await fetch(`${mock.api}/projects/${project.id}/origins`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ pattern: "https://*-acme.vercel.app", kind: "preview" }),
    });
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };

    await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: ["https://x-acme.vercel.app"],
    });

    const listed = (await (await fetch(`${mock.api}/projects/${project.id}/previews`)).json()) as {
      previews: { expires_at: string }[];
    };
    expect(new Date(listed.previews[0]?.expires_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  test("a rollback keeps the origins it froze when one is no longer primary", async ({ mock }) => {
    const project = await newProject(mock, "deploy-rollback-removed");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    await addPrimary(mock, project.id, project.secret, "https://www.acme.com");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const deployment = (await (
      await createDeployment(mock, project.id, project.secret, {
        release_id: release.id,
        targets: "primary",
      })
    ).json()) as { id: string };
    await fetch(`${mock.api}/projects/${project.id}/origins/remove`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ pattern: "https://www.acme.com" }),
    });

    const rollback = await fetch(
      `${mock.base}/deployments/${deployment.id}/rollback?project_id=${project.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({ message: "revert" }),
      },
    );

    expect(rollback.status).toBe(200);
    const restored = (await rollback.json()) as { targets: { origin: string }[] };
    expect(restored.targets.map((target) => target.origin)).toEqual([
      "https://app.acme.com",
      "https://www.acme.com",
    ]);
  });

  test("a live read leaves out an origin the newest primary deployment does not name", async ({
    mock,
  }) => {
    const project = await newProject(mock, "deploy-rollback-narrower");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const narrow = (await (
      await createDeployment(mock, project.id, project.secret, {
        release_id: release.id,
        targets: "primary",
      })
    ).json()) as { id: string };
    await addPrimary(mock, project.id, project.secret, "https://www.acme.com");
    await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: "primary",
    });
    await fetch(`${mock.base}/deployments/${narrow.id}/rollback?project_id=${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ message: "revert" }),
    });

    const live = (await (
      await fetch(`${mock.base}/deployments?project_id=${project.id}&live=true`, {
        headers: { authorization: `Bearer ${project.secret}` },
      })
    ).json()) as { deployments: { targets: { origin: string }[] }[] };

    expect(
      live.deployments.flatMap((deployment) => deployment.targets.map((target) => target.origin)),
    ).toEqual(["https://app.acme.com"]);
  });

  test("rolls back to an earlier deployment, reversing the live release", async ({ mock }) => {
    const project = await newProject(mock, "deploy-rollback");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const first = (await (await createRelease(mock, project.id, project.secret, rel1)).json()) as {
      id: string;
    };
    const firstDeploy = (await (
      await createDeployment(mock, project.id, project.secret, {
        release_id: first.id,
        targets: "primary",
      })
    ).json()) as { id: string };

    const second = (await (await createRelease(mock, project.id, project.secret, rel2)).json()) as {
      id: string;
    };
    await createDeployment(mock, project.id, project.secret, {
      release_id: second.id,
      targets: "primary",
    });

    const rollback = await fetch(
      `${mock.base}/deployments/${firstDeploy.id}/rollback?project_id=${project.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({ message: "revert" }),
      },
    );
    expect(rollback.status).toBe(201);
    const rolled = (await rollback.json()) as {
      release_id: string;
      metadata: { reason: string; rollback_to: string };
    };
    expect(rolled.release_id).toBe(first.id);
    expect(rolled.metadata.reason).toBe("rollback");
    expect(rolled.metadata.rollback_to).toBe(firstDeploy.id);

    const live = (await (
      await fetch(`${mock.base}/deployments?project_id=${project.id}&live=true`)
    ).json()) as { deployments: { release_id: string }[] };
    expect(live.deployments).toHaveLength(1);
    expect(live.deployments[0]?.release_id).toBe(first.id);
  });

  test("a preview deployment defaults an omitted ttl and writes one preview per URL", async ({
    mock,
  }) => {
    const project = await newProject(mock, "deploy-preview");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const url = "https://acme-git-sso-acmeinc.vercel.app";

    // An omitted ttl is accepted: the project's default applies, so the preview
    // is written with a future expiry rather than being refused.
    const deployed = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: [url],
    });
    expect(deployed.status).toBe(201);
    const body = (await deployed.json()) as { targets: { origin: string }[] };
    expect(body.targets).toEqual([{ origin: url }]);

    const listed = (await (await fetch(`${mock.base}/projects/${project.id}/previews`)).json()) as {
      previews: { origin: string; expires_at: string }[];
    };
    expect(listed.previews.map((preview) => preview.origin)).toEqual([url]);
    expect(new Date(listed.previews[0]?.expires_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  test("refuses a deployment that mixes preview URLs with primary origins", async ({ mock }) => {
    const project = await newProject(mock, "deploy-mixed");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };

    const mixed = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: ["https://app.acme.com", "https://acme-git-sso-acmeinc.vercel.app"],
      ttl: "PT168H",
    });
    expect(mixed.status).toBe(400);
    expect(((await mixed.json()) as { code: string }).code).toBe("dep.invalid");
  });

  test("refuses a ttl on a primary-origin deployment", async ({ mock }) => {
    const project = await newProject(mock, "deploy-primary-ttl");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };

    // ttl is only meaningful for previews: a primary-origin deployment that
    // carries one is refused, even though an omitted ttl on a preview defaults.
    const withTtl = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: "primary",
      ttl: "PT168H",
    });
    expect(withTtl.status).toBe(400);
    expect(((await withTtl.json()) as { code: string }).code).toBe("dep.invalid");
  });

  test("removes a preview idempotently and stops listing it", async ({ mock }) => {
    const project = await newProject(mock, "preview-remove");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const url = "https://acme-git-sso-acmeinc.vercel.app";
    await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: [url],
      ttl: "PT168H",
    });

    const removeProjectPreview = () =>
      fetch(`${mock.base}/projects/${project.id}/previews/remove`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({ origin: url }),
      });

    expect((await removeProjectPreview()).status).toBe(204);
    const afterFirst = (await (
      await fetch(`${mock.base}/projects/${project.id}/previews`)
    ).json()) as {
      previews: unknown[];
    };
    expect(afterFirst.previews).toHaveLength(0);

    // Idempotent: removing an already-gone preview still answers 204.
    expect((await removeProjectPreview()).status).toBe(204);
  });

  test("lets a release whose only preview was removed be revoked", async ({ mock }) => {
    const project = await newProject(mock, "preview-remove-revoke");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const url = "https://acme-git-sso-acmeinc.vercel.app";
    await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: [url],
      ttl: "PT168H",
    });
    await fetch(`${mock.base}/projects/${project.id}/previews/remove`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ origin: url }),
    });

    const revoked = await fetch(
      `${mock.base}/releases/${release.id}/revoke?project_id=${project.id}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${project.secret}` },
      },
    );

    expect(revoked.status).toBe(200);
  });

  test("renews a preview's expiry on a re-deploy of unchanged content", async ({ mock }) => {
    const project = await newProject(mock, "preview-renew");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const url = "https://acme-git-sso-acmeinc.vercel.app";

    const first = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: [url],
      ttl: "PT60M",
    });
    expect(first.status).toBe(201);
    const expiresFirst = (
      (await (await fetch(`${mock.base}/projects/${project.id}/previews`)).json()) as {
        previews: { expires_at: string }[];
      }
    ).previews[0]?.expires_at as string;

    // Re-deploying the same release and variables writes a new deployment
    // (201), the renewal, whose ttl pushes the preview's expiry later.
    const again = await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: [url],
      ttl: "PT168H",
    });
    expect(again.status).toBe(201);
    const expiresAgain = (
      (await (await fetch(`${mock.base}/projects/${project.id}/previews`)).json()) as {
        previews: { expires_at: string }[];
      }
    ).previews[0]?.expires_at as string;
    expect(new Date(expiresAgain).getTime()).toBeGreaterThan(new Date(expiresFirst).getTime());
  });

  test("pages the previews list with limit and next_page_token", async ({ mock }) => {
    const project = await newProject(mock, "preview-paging");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const urls = [
      "https://a-acmeinc.vercel.app",
      "https://b-acmeinc.vercel.app",
      "https://c-acmeinc.vercel.app",
    ];
    await createDeployment(mock, project.id, project.secret, {
      release_id: release.id,
      targets: urls,
      ttl: "PT168H",
    });

    const first = (await (
      await fetch(`${mock.base}/projects/${project.id}/previews?limit=2`)
    ).json()) as { previews: { origin: string }[]; next_page_token?: string | null };
    expect(first.previews).toHaveLength(2);
    const token = first.next_page_token;
    expect(typeof token).toBe("string");

    const second = (await (
      await fetch(`${mock.base}/projects/${project.id}/previews?limit=2&page_token=${token}`)
    ).json()) as { previews: { origin: string }[]; next_page_token?: string | null };
    expect(second.previews).toHaveLength(1);
    expect(second.next_page_token ?? null).toBeNull();

    // Every URL appears exactly once across the two pages.
    const seen = [...first.previews, ...second.previews].map((preview) => preview.origin).sort();
    expect(seen).toEqual([...urls].sort());

    // A token the mock never minted is rejected, like the real server.
    const bad = await fetch(`${mock.base}/projects/${project.id}/previews?page_token=not-a-cursor`);
    expect(bad.status).toBe(400);
  });

  test("a preview removal leaves deployment history untouched", async ({ mock }) => {
    const project = await newProject(mock, "preview-remove-history");
    await addPreview(mock, project.id, project.secret, "https://*-acmeinc.vercel.app");
    const release = (await (
      await createRelease(mock, project.id, project.secret, rel1)
    ).json()) as {
      id: string;
    };
    const url = "https://acme-git-sso-acmeinc.vercel.app";
    const deployed = (await (
      await createDeployment(mock, project.id, project.secret, {
        release_id: release.id,
        targets: [url],
        ttl: "PT168H",
      })
    ).json()) as { id: string };
    const historyBefore = (await (
      await fetch(`${mock.base}/deployments/${deployed.id}?project_id=${project.id}`)
    ).json()) as { deployed_at: string; targets: { origin: string }[] };

    const removed = await fetch(`${mock.base}/projects/${project.id}/previews/remove`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
      body: JSON.stringify({ origin: url }),
    });
    expect(removed.status).toBe(204);

    // The live preview list no longer admits the URL — its preview is gone.
    const listed = (await (await fetch(`${mock.base}/projects/${project.id}/previews`)).json()) as {
      previews: unknown[];
    };
    expect(listed.previews).toHaveLength(0);
    // Nor does the live deployments view.
    const liveDeployments = (await (
      await fetch(`${mock.base}/deployments?project_id=${project.id}&live=true`)
    ).json()) as { deployments: unknown[] };
    expect(liveDeployments.deployments).toHaveLength(0);

    // But the deployment that served it keeps its real timestamps — removal
    // ends the preview, it does not rewrite history.
    const historyAfter = (await (
      await fetch(`${mock.base}/deployments/${deployed.id}?project_id=${project.id}`)
    ).json()) as { deployed_at: string; targets: { origin: string }[] };
    expect(historyAfter.deployed_at).toBe(historyBefore.deployed_at);
    expect(historyAfter.targets).toEqual(historyBefore.targets);
  });

  test("refuses to revoke a release an origin still serves, then allows it", async ({ mock }) => {
    const project = await newProject(mock, "release-revoke");
    await addPrimary(mock, project.id, project.secret, "https://app.acme.com");
    const served = (await (await createRelease(mock, project.id, project.secret, rel1)).json()) as {
      id: string;
    };
    await createDeployment(mock, project.id, project.secret, {
      release_id: served.id,
      targets: "primary",
    });

    const inUse = await fetch(
      `${mock.base}/releases/${served.id}/revoke?project_id=${project.id}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${project.secret}` },
      },
    );
    expect(inUse.status).toBe(409);
    expect(((await inUse.json()) as { code: string }).code).toBe("rel.in_use");

    const next = (await (await createRelease(mock, project.id, project.secret, rel2)).json()) as {
      id: string;
    };
    await createDeployment(mock, project.id, project.secret, {
      release_id: next.id,
      targets: "primary",
    });

    const ok = await fetch(`${mock.base}/releases/${served.id}/revoke?project_id=${project.id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${project.secret}` },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { revoked_at: string }).revoked_at).not.toBeNull();
  });

  describe("a release a primary origin and a preview serve", () => {
    /**
     * A preview URL that {@link PREVIEW_PATTERN} admits.
     */
    const PREVIEW_URL = "https://acme-git-sso-acmeinc.vercel.app";

    /**
     * A project serving one release on its primary origin and on a preview URL.
     *
     * @param mock - The mock server the request goes to.
     * @param name - The project's name.
     * @returns The project, the release, and the deployments that serve it on
     * the primary origin and on the preview.
     */
    async function aReleaseServedTwice(mock: MockServer, name: string) {
      const project = await newProject(mock, name);
      await addPrimary(mock, project.id, project.secret, PRIMARY_URL);
      await addPreview(mock, project.id, project.secret, PREVIEW_PATTERN);
      const release = await released(mock, project, rel1);
      const primary = await deployed(mock, project, { release_id: release.id, targets: "primary" });
      const preview = await deployed(mock, project, {
        release_id: release.id,
        targets: [PREVIEW_URL],
        ttl: "PT168H",
      });

      return { project, release, primary, preview };
    }

    /**
     * Puts a second release live on the project's primary origins, as a deploy
     * would.
     *
     * @param mock - The mock server the request goes to.
     * @param project - The project's id and secret.
     * @returns The second release and the deployment that made it live.
     */
    async function aReplacementLive(mock: MockServer, project: { id: string; secret: string }) {
      const release = await released(mock, project, rel2);
      const deployment = await deployed(mock, project, {
        release_id: release.id,
        targets: "primary",
      });

      return { release, deployment };
    }

    /**
     * Revokes a release as the project's operator.
     *
     * @param mock - The mock server the request goes to.
     * @param project - The project's id and secret.
     * @param releaseId - The release to revoke.
     * @returns The platform's answer.
     */
    function revoke(
      mock: MockServer,
      project: { id: string; secret: string },
      releaseId: string,
    ): Promise<Response> {
      return fetch(`${mock.base}/releases/${releaseId}/revoke?project_id=${project.id}`, {
        method: "POST",
        headers: { authorization: `Bearer ${project.secret}` },
      });
    }

    /**
     * Drops an origin from the project's origins as its operator.
     *
     * @param mock - The mock server the request goes to.
     * @param project - The project's id and secret.
     * @param pattern - The origin to drop.
     * @returns The platform's answer.
     */
    function removeOrigin(
      mock: MockServer,
      project: { id: string; secret: string },
      pattern: string,
    ): Promise<Response> {
      return fetch(`${mock.base}/projects/${project.id}/origins/remove`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${project.secret}` },
        body: JSON.stringify({ pattern }),
      });
    }

    /**
     * What the live deployments view shows: each deployment with its release and
     * the origins it serves.
     *
     * @param mock - The mock server the request goes to.
     * @param projectId - The project.
     * @param origin - Ask only about this origin, as the API allows.
     * @returns One entry per live deployment: its id, its release and its origins.
     */
    async function liveView(mock: MockServer, projectId: string, origin?: string) {
      const filter = origin === undefined ? "" : `&origin=${encodeURIComponent(origin)}`;
      const live = (await (
        await fetch(`${mock.base}/deployments?project_id=${projectId}&live=true${filter}`)
      ).json()) as {
        deployments: { id: string; release_id: string; targets: { origin: string }[] }[];
      };

      return live.deployments.map((deployment) => {
        return [
          deployment.id,
          deployment.release_id,
          deployment.targets.map((target) => {
            return target.origin;
          }),
        ];
      });
    }

    /**
     * A project whose primary origin was dropped while its newest primary
     * deployment still names it, and whose live preview then reused that URL.
     *
     * @param mock - The mock server the request goes to.
     * @param name - The project's name.
     * @returns The project, its release, the URL and the deployments naming it.
     */
    async function aPrimaryUrlReusedByAPreview(mock: MockServer, name: string) {
      const project = await newProject(mock, name);
      const reused = "https://app-acmeinc.vercel.app";
      await addPrimary(mock, project.id, project.secret, reused);
      await addPreview(mock, project.id, project.secret, PREVIEW_PATTERN);
      const release = await released(mock, project, rel1);
      const primary = await deployed(mock, project, { release_id: release.id, targets: "primary" });
      await removeOrigin(mock, project, reused);
      const preview = await deployed(mock, project, {
        release_id: release.id,
        targets: [reused],
        ttl: "PT168H",
      });

      return { project, release, reused, primary, preview };
    }

    /**
     * The status a deployment is read with by its ID.
     *
     * @param mock - The mock server the request goes to.
     * @param projectId - The project.
     * @param deploymentId - The deployment.
     * @returns Its status, `live` or `inactive`.
     */
    async function statusOf(
      mock: MockServer,
      projectId: string,
      deploymentId: string,
    ): Promise<string> {
      const response = await fetch(
        `${mock.base}/deployments/${deploymentId}?project_id=${projectId}`,
      );
      const deployment = (await response.json()) as { status: string };

      return deployment.status;
    }

    /**
     * The status of every deployment the history lists.
     *
     * @param mock - The mock server the request goes to.
     * @param projectId - The project.
     * @returns Each deployment's id and status, newest first.
     */
    async function historyStatuses(mock: MockServer, projectId: string) {
      const response = await fetch(`${mock.base}/deployments?project_id=${projectId}`);
      const history = (await response.json()) as {
        deployments: { id: string; status: string }[];
      };

      return history.deployments.map((deployment) => {
        return [deployment.id, deployment.status];
      });
    }

    describe("revoking it", () => {
      test("names each origin with its kind and the deployment that pins the release there", async ({
        mock,
      }) => {
        const { project, release, primary, preview } = await aReleaseServedTwice(
          mock,
          "revoke-both",
        );

        const refused = await revoke(mock, project, release.id);

        expect(refused.status).toBe(409);
        expect(await refused.json()).toEqual({
          code: "rel.in_use",
          message: "release: still served by an origin",
          details: {
            origins: [
              { origin: PREVIEW_URL, deployment_id: preview.id, kind: "preview" },
              { origin: PRIMARY_URL, deployment_id: primary.id, kind: "primary" },
            ],
          },
        });
      });

      test("lists the origins in byte order, as the server does", async ({ mock }) => {
        const project = await newProject(mock, "revoke-byte-order");
        await addPrimary(mock, project.id, project.secret, "https://app.test:3000");
        await addPrimary(mock, project.id, project.secret, "https://app.test.dev");
        const release = await released(mock, project, rel1);
        await deployed(mock, project, { release_id: release.id, targets: "primary" });

        const refused = await revoke(mock, project, release.id);

        const body = (await refused.json()) as { details: { origins: { origin: string }[] } };
        expect(
          body.details.origins.map((entry) => {
            return entry.origin;
          }),
        ).toEqual(["https://app.test.dev", "https://app.test:3000"]);
      });

      test("still names the primary origin once the preview is removed", async ({ mock }) => {
        const { project, release, primary } = await aReleaseServedTwice(
          mock,
          "revoke-preview-removed",
        );
        await removeLivePreview(mock, project, PREVIEW_URL);

        const refused = await revoke(mock, project, release.id);

        expect(refused.status).toBe(409);
        expect(((await refused.json()) as { details: unknown }).details).toEqual({
          origins: [{ origin: PRIMARY_URL, deployment_id: primary.id, kind: "primary" }],
        });
      });

      test("still names the preview once another release is live on the primary origin", async ({
        mock,
      }) => {
        const { project, release, preview } = await aReleaseServedTwice(
          mock,
          "revoke-primary-replaced",
        );
        await aReplacementLive(mock, project);

        const refused = await revoke(mock, project, release.id);

        expect(refused.status).toBe(409);
        expect(((await refused.json()) as { details: unknown }).details).toEqual({
          origins: [{ origin: PREVIEW_URL, deployment_id: preview.id, kind: "preview" }],
        });
      });

      test("allows the revoke once the preview is removed and another release is live", async ({
        mock,
      }) => {
        const { project, release } = await aReleaseServedTwice(mock, "revoke-freed");
        await removeLivePreview(mock, project, PREVIEW_URL);
        await aReplacementLive(mock, project);

        const revoked = await revoke(mock, project, release.id);

        expect(revoked.status).toBe(200);
      });

      test("allows the revoke of a release only an older primary deployment named once a newer one names fewer origins", async ({
        mock,
      }) => {
        const project = await newProject(mock, "revoke-older-primary");
        await addPrimary(mock, project.id, project.secret, PRIMARY_URL);
        await addPrimary(mock, project.id, project.secret, "https://app2.acme.com");
        const older = await released(mock, project, rel1);
        await deployed(mock, project, { release_id: older.id, targets: "primary" });
        await removeOrigin(mock, project, "https://app2.acme.com");
        await aReplacementLive(mock, project);

        const revoked = await revoke(mock, project, older.id);

        expect(revoked.status).toBe(200);
      });

      test("is not held by a preview that has expired", async ({ clock, mock }) => {
        const { project, release } = await aReleaseServedTwice(mock, "revoke-preview-expired");
        await aReplacementLive(mock, project);
        clock.set(Date.now() + 8 * 24 * 3_600_000);

        const revoked = await revoke(mock, project, release.id);

        expect(revoked.status).toBe(200);
      });

      test("still names a primary origin the project stopped listing once the preview that reused its URL ended", async ({
        mock,
      }) => {
        const { project, release, reused, primary } = await aPrimaryUrlReusedByAPreview(
          mock,
          "revoke-unlisted-primary",
        );
        await removeLivePreview(mock, project, reused);

        const refused = await revoke(mock, project, release.id);

        expect(refused.status).toBe(409);
        expect(((await refused.json()) as { details: unknown }).details).toEqual({
          origins: [{ origin: reused, deployment_id: primary.id, kind: "primary" }],
        });
      });
    });

    describe("the live deployments view", () => {
      test("shows both deployments in the live view when a preview reused a primary URL the project stopped listing", async ({
        mock,
      }) => {
        const { project, release, reused, primary, preview } = await aPrimaryUrlReusedByAPreview(
          mock,
          "revoke-live-reused",
        );

        const live = await liveView(mock, project.id);

        expect(live).toEqual([
          [preview.id, release.id, [reused]],
          [primary.id, release.id, [reused]],
        ]);
      });

      test("shows only the preview for that URL in the live view when asked about the origin", async ({
        mock,
      }) => {
        const { project, release, reused, preview } = await aPrimaryUrlReusedByAPreview(
          mock,
          "revoke-live-origin",
        );

        const live = await liveView(mock, project.id, reused);

        expect(live).toEqual([[preview.id, release.id, [reused]]]);
      });

      test("shows nothing for that URL in the live view when asked about the origin once the preview ended", async ({
        mock,
      }) => {
        const { project, reused } = await aPrimaryUrlReusedByAPreview(
          mock,
          "revoke-live-origin-ended",
        );
        await removeLivePreview(mock, project, reused);

        const live = await liveView(mock, project.id, reused);

        expect(live).toEqual([]);
      });

      test("reports every origin a deployment serves in the live view when asked about one of them", async ({
        mock,
      }) => {
        const project = await newProject(mock, "revoke-live-all-origins");
        await addPrimary(mock, project.id, project.secret, PRIMARY_URL);
        await addPrimary(mock, project.id, project.secret, "https://app2.acme.com");
        const release = await released(mock, project, rel1);
        const deployment = await deployed(mock, project, {
          release_id: release.id,
          targets: "primary",
        });

        const live = await liveView(mock, project.id, PRIMARY_URL);

        expect(live).toEqual([[deployment.id, release.id, [PRIMARY_URL, "https://app2.acme.com"]]]);
      });

      test("shows the primary deployment for a listed primary origin in the live view when asked about the origin", async ({
        mock,
      }) => {
        const { project, release, primary } = await aReleaseServedTwice(mock, "revoke-live-listed");

        const live = await liveView(mock, project.id, PRIMARY_URL);

        expect(live).toEqual([[primary.id, release.id, [PRIMARY_URL]]]);
      });

      test("shows the primary deployment and the preview that serve the release in the live view", async ({
        mock,
      }) => {
        const { project, release, primary, preview } = await aReleaseServedTwice(
          mock,
          "revoke-live-view",
        );

        const live = await liveView(mock, project.id);

        expect(live).toEqual([
          [preview.id, release.id, [PREVIEW_URL]],
          [primary.id, release.id, [PRIMARY_URL]],
        ]);
      });

      test("stops showing a primary deployment another release replaced in the live view", async ({
        mock,
      }) => {
        const { project, release, preview } = await aReleaseServedTwice(
          mock,
          "revoke-live-replaced",
        );
        const replacement = await aReplacementLive(mock, project);

        const live = await liveView(mock, project.id);

        expect(live).toEqual([
          [replacement.deployment.id, replacement.release.id, [PRIMARY_URL]],
          [preview.id, release.id, [PREVIEW_URL]],
        ]);
      });
    });

    describe("the deployments of one release", () => {
      /**
       * The ids of the deployments a list narrowed to one release answers.
       *
       * @param mock - The mock server the request goes to.
       * @param projectId - The project.
       * @param releaseId - The release to narrow the list to.
       * @param live - List the live view instead of the history.
       * @returns The deployment ids, newest first.
       */
      async function ofRelease(
        mock: MockServer,
        projectId: string,
        releaseId: string,
        live = false,
      ) {
        const view = live ? "&live=true" : "";
        const response = await fetch(
          `${mock.base}/deployments?project_id=${projectId}&release_id=${releaseId}${view}`,
        );
        const listed = (await response.json()) as { deployments: { id: string }[] };

        return listed.deployments.map((deployment) => {
          return deployment.id;
        });
      }

      test("lists every deployment of the release in the history, superseded ones included", async ({
        mock,
      }) => {
        const { project, release, primary, preview } = await aReleaseServedTwice(
          mock,
          "release-history",
        );
        const replacement = await aReplacementLive(mock, project);

        expect(await ofRelease(mock, project.id, release.id)).toEqual([preview.id, primary.id]);
        expect(await ofRelease(mock, project.id, replacement.release.id)).toEqual([
          replacement.deployment.id,
        ]);
      });

      test("lists only the live deployments that serve the release in the live view", async ({
        mock,
      }) => {
        const { project, release, preview } = await aReleaseServedTwice(mock, "release-live");
        await aReplacementLive(mock, project);

        expect(await ofRelease(mock, project.id, release.id, true)).toEqual([preview.id]);
      });
    });

    describe("a deployment's status", () => {
      test("is live for a preview deployment while its preview serves", async ({ mock }) => {
        const { project, preview } = await aReleaseServedTwice(mock, "status-preview-live");

        const status = await statusOf(mock, project.id, preview.id);

        expect(status).toBe("live");
      });

      test("turns inactive for a preview deployment once its preview is removed", async ({
        mock,
      }) => {
        const { project, preview } = await aReleaseServedTwice(mock, "status-preview-removed");
        await removeLivePreview(mock, project, PREVIEW_URL);

        const status = await statusOf(mock, project.id, preview.id);

        expect(status).toBe("inactive");
      });

      test("turns inactive for a preview deployment once its preview has expired", async ({
        clock,
        mock,
      }) => {
        const { project, preview } = await aReleaseServedTwice(mock, "status-preview-expired");
        clock.set(Date.now() + 8 * 24 * 3_600_000);

        const status = await statusOf(mock, project.id, preview.id);

        expect(status).toBe("inactive");
      });

      test("lists a removed preview's deployment inactive beside the live primary one", async ({
        mock,
      }) => {
        const { project, primary, preview } = await aReleaseServedTwice(mock, "status-history");
        await removeLivePreview(mock, project, PREVIEW_URL);

        const history = await historyStatuses(mock, project.id);

        expect(history).toEqual([
          [preview.id, "inactive"],
          [primary.id, "live"],
        ]);
      });

      test("stays live for the newest primary deployment once the project stops listing its origin", async ({
        mock,
      }) => {
        const { project, primary } = await aPrimaryUrlReusedByAPreview(mock, "status-unlisted");

        const status = await statusOf(mock, project.id, primary.id);

        expect(status).toBe("live");
      });
    });
  });
});

/**
 * The answers no other test here needs, so the route coverage below can prove
 * every handler's success and error paths were checked against the contract.
 */
describe("api-mock error paths — each refusal a handler names", () => {
  async function newProject(
    mock: MockServer,
    name: string,
  ): Promise<{ id: string; secret: string }> {
    const res = await fetch(`${mock.api}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; project_secret: string };
    return { id: body.id, secret: body.project_secret };
  }

  const send = (
    mock: MockServer,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(`${mock.api}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });

  async function expectRefusal(res: Response, status: number, code: string): Promise<void> {
    expect({ status: res.status, code: ((await res.json()) as { code: string }).code }).toEqual({
      status,
      code,
    });
  }

  const UNKNOWN_PROJECT = "proj_does_not_exist";

  test("a body that is not JSON is req.invalid", async ({ mock }) => {
    const { id } = await newProject(mock, "error-paths-json");
    for (const path of [
      "/projects",
      `/projects/${id}/origins`,
      `/projects/${id}/origins/remove`,
      `/projects/${id}/previews/remove`,
      `/releases?project_id=${id}`,
      `/policies?project_id=${id}`,
    ]) {
      await expectRefusal(await send(mock, "POST", path, "{not json"), 400, "req.invalid");
    }
    await expectRefusal(
      await send(mock, "PATCH", `/variables?project_id=${id}`, "{not json"),
      400,
      "req.invalid",
    );
  });

  test("an origin of a project the mock does not hold is origin.not_found", async ({ mock }) => {
    const pattern = { pattern: "https://app.acme.com", kind: "primary" };
    await expectRefusal(
      await send(mock, "POST", `/projects/${UNKNOWN_PROJECT}/origins`, pattern),
      404,
      "origin.not_found",
    );
    await expectRefusal(
      await send(mock, "POST", `/projects/${UNKNOWN_PROJECT}/origins/remove`, {
        pattern: pattern.pattern,
      }),
      404,
      "origin.not_found",
    );
  });

  test("a release of a project the mock does not hold is rel.project_not_found", async ({
    mock,
  }) => {
    await expectRefusal(
      await send(mock, "POST", `/releases?project_id=${UNKNOWN_PROJECT}`, {
        pointers: [{ kind: "schema", revision_id: "sch_a" }],
      }),
      404,
      "rel.project_not_found",
    );
    await expectRefusal(
      await send(mock, "POST", `/releases/build?project_id=${UNKNOWN_PROJECT}`, {
        bundle: { schemas: [] },
      }),
      404,
      "rel.project_not_found",
    );
  });

  test("a release reads back by id, and an unknown one is rel.not_found", async ({ mock }) => {
    const { id } = await newProject(mock, "error-paths-release");
    const created = await send(mock, "POST", `/releases?project_id=${id}`, {
      pointers: [{ kind: "schema", revision_id: "sch_a" }],
    });
    const release = (await created.json()) as { id: string };
    expect((await send(mock, "GET", `/releases/${release.id}?project_id=${id}`)).status).toBe(200);
    await expectRefusal(
      await send(mock, "GET", `/releases/rel_missing?project_id=${id}`),
      404,
      "rel.not_found",
    );
    await expectRefusal(
      await send(mock, "POST", `/releases/rel_missing/revoke?project_id=${id}`),
      404,
      "rel.not_found",
    );
  });

  test("a deployment names a project, release and targets the mock holds", async ({ mock }) => {
    const { id } = await newProject(mock, "error-paths-deploy");
    await send(mock, "POST", `/projects/${id}/origins`, {
      pattern: "https://app.acme.com",
      kind: "primary",
    });
    await send(mock, "POST", `/projects/${id}/origins`, {
      pattern: "https://*.preview.acme.com",
      kind: "preview",
    });
    const release = async (revision: string) =>
      (
        (await (
          await send(mock, "POST", `/releases?project_id=${id}`, {
            pointers: [{ kind: "schema", revision_id: revision }],
          })
        ).json()) as { id: string }
      ).id;
    const first = await release("sch_first");
    const second = await release("sch_second");

    await expectRefusal(
      await send(mock, "POST", `/deployments?project_id=${UNKNOWN_PROJECT}`, {
        release_id: first,
        targets: "primary",
      }),
      404,
      "env.project_not_found",
    );
    await expectRefusal(
      await send(mock, "POST", `/deployments?project_id=${id}`, {
        release_id: "rel_missing",
        targets: "primary",
      }),
      404,
      "rel.not_found",
    );
    const preview = "https://one.preview.acme.com";
    await expectRefusal(
      await send(mock, "POST", `/deployments?project_id=${id}`, {
        release_id: first,
        targets: [preview, preview],
      }),
      400,
      "req.invalid",
    );

    const deployFirst = await send(mock, "POST", `/deployments?project_id=${id}`, {
      release_id: first,
      targets: "primary",
    });
    const firstDeployment = (await deployFirst.json()) as { id: string };
    await expectRefusal(
      await send(mock, "POST", `/deployments?project_id=${id}`, {
        release_id: second,
        targets: "primary",
        expected_deployment_id: "dep_not_the_newest",
      }),
      409,
      "dep.conflict",
    );
    expect(
      (
        await send(mock, "POST", `/deployments?project_id=${id}`, {
          release_id: second,
          targets: "primary",
        })
      ).status,
    ).toBe(201);
    const previewDeployment = (await (
      await send(mock, "POST", `/deployments?project_id=${id}`, {
        release_id: second,
        targets: [preview],
      })
    ).json()) as { id: string };

    // The first release is served nowhere now, so it can be revoked: neither
    // a deploy nor a rollback may serve it again.
    expect((await send(mock, "POST", `/releases/${first}/revoke?project_id=${id}`)).status).toBe(
      200,
    );
    await expectRefusal(
      await send(mock, "POST", `/deployments?project_id=${id}`, {
        release_id: first,
        targets: "primary",
      }),
      409,
      "rel.revoked",
    );
    await expectRefusal(
      await send(mock, "POST", `/deployments/${firstDeployment.id}/rollback?project_id=${id}`, {}),
      409,
      "rel.revoked",
    );
    await expectRefusal(
      await send(
        mock,
        "POST",
        `/deployments/${previewDeployment.id}/rollback?project_id=${id}`,
        {},
      ),
      400,
      "dep.invalid",
    );
    await expectRefusal(
      await send(mock, "POST", `/deployments/dep_missing/rollback?project_id=${id}`, {}),
      404,
      "dep.not_found",
    );
    await expectRefusal(
      await send(
        mock,
        "POST",
        `/deployments/${firstDeployment.id}/rollback?project_id=${UNKNOWN_PROJECT}`,
        {},
      ),
      404,
      "env.project_not_found",
    );
    await expectRefusal(
      await send(mock, "GET", `/deployments/dep_missing?project_id=${id}`),
      404,
      "dep.not_found",
    );
    await expectRefusal(
      await send(mock, "GET", `/deployments?project_id=${id}&page_token=not-a-cursor`),
      400,
      "req.invalid",
    );
  });

  test("a claim needs the project secret, and an unknown challenge is claim_challenge.not_found", async ({
    mock,
  }) => {
    const { id, secret } = await newProject(mock, "error-paths-claim");
    await expectRefusal(
      await send(mock, "POST", `/projects/${id}/claim/init`),
      401,
      "auth.unauthorized",
    );
    const init = await send(mock, "POST", `/projects/${id}/claim/init`, undefined, {
      authorization: `Bearer ${secret}`,
    });
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    expect(
      (await send(mock, "GET", `/projects/${id}/claim/window?challenge_id=${challenge_id}`)).status,
    ).toBe(200);
    await expectRefusal(
      await send(mock, "GET", `/projects/${id}/claim/window?challenge_id=ch_missing`),
      404,
      "claim_challenge.not_found",
    );
    await expectRefusal(
      await send(mock, "GET", `/projects/${id}/claim/status?challenge_id=ch_missing`, undefined, {
        authorization: `Bearer ${secret}`,
      }),
      404,
      "claim_challenge.not_found",
    );
  });

  test("POST /users/query answers the project secret's users, and refuses without it", async ({
    mock,
  }) => {
    const { secret } = await newProject(mock, "error-paths-users");
    const ok = await send(mock, "POST", "/users/query", {}, { authorization: `Bearer ${secret}` });
    expect(ok.status).toBe(200);
    await expectRefusal(await send(mock, "POST", "/users/query", {}), 401, "auth.unauthorized");
  });

  test("an unknown flow definition is flowdef.not_found", async ({ mock }) => {
    await expectRefusal(
      await send(mock, "GET", "/flow_definitions/flowdef_missing"),
      404,
      "flowdef.not_found",
    );
  });

  test("a policy publishes, reads back by id and revision, and refuses what it does not hold", async ({
    mock,
  }) => {
    const { id } = await newProject(mock, "error-paths-policy");
    const operation = "auth.factor.password.set";
    await expectRefusal(
      await send(mock, "POST", `/policies?project_id=${id}`, {
        operation,
        config: { min_length: 20, max_length: 10 },
      }),
      400,
      "pol.invalid",
    );
    const published = await send(mock, "POST", `/policies?project_id=${id}`, {
      operation,
      config: { min_length: 12 },
    });
    expect(published.status).toBe(201);
    const policy = (await published.json()) as { id: string; revision_id: string };
    for (const path of [
      `/policies/${policy.id}`,
      `/policies/${policy.id}/revisions`,
      `/policies/revisions/${policy.revision_id}`,
    ]) {
      expect((await send(mock, "GET", `${path}?project_id=${id}`)).status, path).toBe(200);
      const missing = path
        .replace(policy.id, "pol_missing")
        .replace(policy.revision_id, "polrev_missing");
      await expectRefusal(
        await send(mock, "GET", `${missing}?project_id=${id}`),
        404,
        "pol.not_found",
      );
    }
  });

  test("deleting a variable the project does not hold is var.not_found", async ({ mock }) => {
    const { id } = await newProject(mock, "error-paths-variables");
    await expectRefusal(
      await send(mock, "DELETE", `/variables/MISSING?project_id=${id}`),
      404,
      "var.not_found",
    );
  });

  describe("the login flow", () => {
    const start = async (mock: MockServer, purpose: "login" | "register") => {
      const res = await send(mock, "POST", "/flows", { purpose, project_id: "proj_error_paths" });
      expect(res.status).toBe(201);
      return (await res.json()) as { id: string; session_token: string };
    };

    test("starts, reads back and advances a sign-in", async ({ mock }) => {
      const flow = await start(mock, "login");
      expect((await send(mock, "GET", `/flows/${flow.id}`)).status).toBe(200);
      const next = await send(mock, "POST", `/flows/${flow.id}/submit`, {
        session_token: flow.session_token,
        action: "submit",
        fields: { email: "error-paths@example.com" },
      });
      expect(next.status).toBe(200);
    });

    test("refuses an sso submission without return_target, and any submit on sso-redirect", async ({
      mock,
    }) => {
      const flow = await start(mock, "login");
      const sso = {
        session_token: flow.session_token,
        action: "sso",
        fields: {},
        sso_provider_id: "google",
      };
      await expectRefusal(
        await send(mock, "POST", `/flows/${flow.id}/submit`, sso),
        400,
        "req.invalid",
      );
      const redirect = await send(mock, "POST", `/flows/${flow.id}/submit`, {
        ...sso,
        return_target: `${mock.base}/login`,
      });
      expect(redirect.status).toBe(200);
      await expectRefusal(
        await send(mock, "POST", `/flows/${flow.id}/submit`, { action: "submit", fields: {} }),
        400,
        "flow.invalid_action",
      );
    });

    test("refuses a sign-up without its proof of work", async ({ mock }) => {
      const flow = await start(mock, "register");
      const password = (await (
        await send(mock, "POST", `/flows/${flow.id}/submit`, {
          session_token: flow.session_token,
          action: "submit",
          fields: { email: "error-paths-signup@example.com", given_name: "E", family_name: "P" },
        })
      ).json()) as { id: string; session_token: string; step: { name: string } };
      expect(password.step.name).toBe("register-password");
      await expectRefusal(
        await send(mock, "POST", `/flows/${password.id}/submit`, {
          session_token: password.session_token,
          action: "submit",
          fields: { [PASSWORD_FIELD]: "hunter2-hunter2" },
        }),
        403,
        "flow.proof_invalid",
      );
    });
  });

  /**
   * The session handlers the Express routes shadow on the server, as the
   * component, SDK and CLI tests reach them with `setupServer(...)`.
   */
  describe("in process", () => {
    const mock = setupMockHandlers();
    test.beforeEach(({ server: inProcess }) => {
      inProcess.use(...mock.handlers);
    });

    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${IN_PROCESS_ORIGIN}${API_PREFIX}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    test("exchanges a handoff token, and answers 503 when told to fail", async () => {
      expect(
        (
          await call("POST", "/sessions/exchange?project_id=proj_in_process", {
            handoff_token: "t",
          })
        ).status,
      ).toBe(200);
      mock.failNextExchange();
      await expectRefusal(
        await call("POST", "/sessions/exchange?project_id=proj_in_process", { handoff_token: "t" }),
        503,
        "unavailable",
      );
    });

    // submitFlowStep's 400 is either shape: this is the step with its error,
    // the server-transport tests above send the error envelope.
    test("refuses a submit as the same step with an error when told to", async () => {
      const start = await call("POST", "/flows", {
        purpose: "login",
        project_id: "proj_in_process",
      });
      const flow = (await start.json()) as { id: string; session_token: string };
      mock.rejectNextSubmit("error.invalid_credentials");
      const res = await call("POST", `/flows/${flow.id}/submit`, {
        session_token: flow.session_token,
        action: "submit",
        fields: { email: "in-process@example.com" },
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { step: { error: string } }).step.error).toBe(
        "error.invalid_credentials",
      );
    });

    test("answers the session reads and sign-out of a signed-out browser with 401", async () => {
      await expectRefusal(await call("GET", "/sessions/me"), 401, "auth.unauthorized");
      await expectRefusal(await call("GET", "/sessions/me/csrf"), 401, "auth.unauthorized");
      await expectRefusal(await call("DELETE", "/sessions/me"), 401, "auth.unauthorized");
    });
  });
});

describe("api-mock route coverage — every handler answers by the contract", () => {
  const app = createMockApp({ issuer: IN_PROCESS_ORIGIN });
  const routes = mockRoutes(app);
  const inSpec = new Set(specOperations.map((op) => routeKey(op.method, op.path)));

  test("every route is a spec operation or listed as out of spec, with its reason", () => {
    const listed = new Set(Object.keys(OUT_OF_SPEC_ROUTES).map((k) => routeKey(...splitKey(k))));
    const unknown = routes
      .map((r) => routeKey(r.method, r.path))
      .filter((key) => !inSpec.has(key) && !listed.has(key));
    expect(unknown, "add these to the spec or to OUT_OF_SPEC_ROUTES").toEqual([]);
    const served = new Set(routes.map((r) => routeKey(r.method, r.path)));
    const stale = [...listed].filter((key) => inSpec.has(key) || !served.has(key));
    expect(stale, "OUT_OF_SPEC_ROUTES entries the spec now has or no route serves").toEqual([]);
  });

  test("every server route answered its success path, and every in-process one answered", () => {
    const missing: string[] = [];
    for (const route of routes) {
      const key = routeKey(route.method, route.path);
      if (!inSpec.has(key)) continue;
      const seen = observations.filter((o) => o.transport === route.transport && o.key === key);
      // The in-process session handlers only answer a signed-out browser.
      const answered =
        route.transport === "in-process" ? seen.length > 0 : seen.some((o) => o.status < 400);
      if (!answered) {
        missing.push(
          `${key} (${route.transport}): no ${route.transport === "server" ? "success " : ""}answer`,
        );
      }
    }
    expect(
      missing,
      "only answers to requests made through this file's conformantFetch count: test these routes here",
    ).toEqual([]);
  });
});

function splitKey(key: string): [string, string] {
  const [method, path] = key.split(" ");
  return [method ?? "", path ?? ""];
}
