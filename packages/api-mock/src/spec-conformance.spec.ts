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
 *   - PUT  /flow_definitions/:id        → UpdateFlowDefinitionResponse
 *
 * Endpoints covered structurally (orval emits no `*Response` zod for these
 * because they have no static response schema — POSTs that return only an
 * `id`, or out-of-spec routes):
 *   - POST /projects                    → { id, project_secret, … }
 *   - POST /schemas                     → { id }
 *   - POST /flow_definitions            → flow-definition-response envelope
 *
 * `GET /schemas/:id` is NOT zod-validated here: the mock stores whatever
 * the user POSTed verbatim, so the response shape depends on the request
 * the caller made. The structural test below just exercises the 404 path
 * (clear contract: spec-compliant error envelope).
 */
import type { Server } from "node:http";

import {
  CompleteClaimResponse,
  ExchangeHandoffResponse,
  GetClaimStatusResponse,
  GetFlowDefinitionResponse,
  GetMySessionResponse,
  GetProjectResponse,
  ListFlowDefinitionsResponse,
  UpdateFlowDefinitionResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { signHandoffToken } from "./crypto.js";
import {
  expireClaimChallenge,
  expireClaimWindow,
  snapshotPlatformStore,
} from "./platform-handlers.js";
import { PLATFORM_PROJECT_ID, startMockServer } from "./server.js";

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
    expect(
      revoke.headers.getSetCookie().some((c) => /^__nextgen_session=;/.test(c)),
    ).toBe(true);

    // Session is gone after revocation.
    const after = await fetch(`${BASE}/sessions/me`, { headers: { cookie: sessionCookie } });
    expect(after.status).toBe(401);
  });

  test("DELETE /sessions/me without a session cookie returns 401", async () => {
    const res = await fetch(`${BASE}/sessions/me`, { method: "DELETE" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("unauthenticated");
  });

  test("DELETE /sessions/me with an unknown session token returns 404", async () => {
    const res = await fetch(`${BASE}/sessions/me`, {
      method: "DELETE",
      headers: { cookie: "__nextgen_session=deadbeefdeadbeef" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("session_not_found");
  });

  test("POST /projects returns the spec-defined project shape", async () => {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "conformance-app",
        preview_origins: ["http://localhost:3000"],
        seed_defaults: false,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    // No CreateProjectResponse zod schema is emitted by orval. Validate
    // structurally against the fields create-project-response.yaml requires.
    expect(typeof body.id).toBe("string");
    expect(body.name).toBe("conformance-app");
    expect(typeof body.project_secret).toBe("string");
    expect(typeof body.preview_secret).toBe("string");
    expect(Array.isArray(body.preview_origins)).toBe(true);
    expect(typeof body.created_at).toBe("string");
  });

  test("GET /projects/:id matches GetProjectResponse", async () => {
    const create = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "conformance-app" }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await fetch(`${BASE}/projects/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => GetProjectResponse.parse(body)).not.toThrow();
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

  test("PUT /flow_definitions/:id matches UpdateFlowDefinitionResponse", async () => {
    const create = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_update",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    const { id } = (await create.json()) as { id: string };
    // Spec: `updateFlowDefinition` is flat-by-id `PUT /flow_definitions/{id}`
    // (no project_id query). The body wraps the definition under
    // `flow_definition` (flow-definition-update-request.yaml), unlike the
    // create envelope.
    const res = await fetch(`${BASE}/flow_definitions/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow_definition: validFlowDefinitionBody() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => UpdateFlowDefinitionResponse.parse(body)).not.toThrow();
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
      headers: { "content-type": "application/json", cookie },
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
      headers: { "content-type": "application/json", cookie },
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
      headers: { "content-type": "application/json", cookie },
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
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(410);
    const completeBody = (await complete.json()) as Record<string, unknown>;
    expect(completeBody.code).toBe("proj.claim_window_expired");
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

  test("POST /projects/:id/claim/complete with an unknown challenge returns 404", async () => {
    const project = await createProject("claim-complete-unknown");
    const cookie = await platformSessionCookie();
    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challenge_id: "ch_doesnotexist" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /projects/:id/claim/complete without challenge_id returns 400", async () => {
    const project = await createProject("claim-complete-missing-id");
    const cookie = await platformSessionCookie();
    const res = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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
      headers: { "content-type": "application/json", cookie },
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
      headers: { "content-type": "application/json", cookie },
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

    const first = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as { code: string; details: Record<string, unknown> };
    expect(secondBody.code).toBe("proj.already_claimed");
    expect(typeof secondBody.details.team_id).toBe("string");
    expect(() => new URL(secondBody.details.dashboard_url as string)).not.toThrow();
  });

  test("a completed challenge still returns 410 from status once expired", async () => {
    const project = await createProject("claim-completed-expired");
    const init = await initClaim(project.id, project.projectSecret);
    const { challenge_id } = (await init.json()) as { challenge_id: string };
    const cookie = await platformSessionCookie();
    const complete = await fetch(`${BASE}/projects/${project.id}/claim/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challenge_id }),
    });
    expect(complete.status).toBe(200);

    expireClaimChallenge(challenge_id);
    const status = await claimStatus(project.id, challenge_id, project.projectSecret);
    expect(status.status).toBe(410);
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(statusBody.code).toBe("proj.claim_expired");
  });
});
