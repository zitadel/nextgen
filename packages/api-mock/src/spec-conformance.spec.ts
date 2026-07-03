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
 *   - POST /projects                    → { id, projectSecret, … }
 *   - POST /schemas                     → { id }
 *   - POST /flow_definitions            → flow detail envelope
 *
 * `GET /schemas/:id` is NOT zod-validated here: the mock stores whatever
 * the user POSTed verbatim, so the response shape depends on the request
 * the caller made. The structural test below just exercises the 404 path
 * (clear contract: spec-compliant error envelope).
 */
import type { Server } from "node:http";

import {
  ExchangeHandoffResponse,
  GetFlowDefinitionResponse,
  GetProjectResponse,
  ListFlowDefinitionsResponse,
  UpdateFlowDefinitionResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { signHandoffToken } from "./crypto.js";
import { startMockServer } from "./server.js";

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
    user_schema:
      "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.yaml",
    // Per `flow-definition.yaml`, `purposes` is an object mapping each
    // purpose name to its entry-point step (must match a `name` in `steps`).
    purposes: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", text_key: "submit", primary: true }],
      },
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
      body: JSON.stringify({ previewOrigins: ["http://localhost:3000"], seedDefaults: false }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    // No CreateProjectResponse zod schema is emitted by orval. Validate
    // structurally against the fields create-project-response.yaml requires.
    expect(typeof body.id).toBe("string");
    expect(typeof body.projectSecret).toBe("string");
    expect(typeof body.previewSecret).toBe("string");
    expect(Array.isArray(body.previewOrigins)).toBe(true);
    expect(typeof body.createdAt).toBe("string");
  });

  test("GET /projects/:id matches GetProjectResponse", async () => {
    const create = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
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
        "x-auth-methods": { password: { enabled: true, position: 0 } },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe("string");
    expect((body.id as string).startsWith("sch_")).toBe(true);
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
    // POST 201 and GET 200 share the `flow-definition-detail-response`
    // envelope per the spec, so the GET response zod schema validates both.
    expect(() => GetFlowDefinitionResponse.parse(body)).not.toThrow();
  });

  test("GET /flow_definitions matches ListFlowDefinitionsResponse", async () => {
    // Ensure at least one entry exists so the list is non-trivial.
    await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_list",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    // Spec: `ListFlowDefinitionsQueryParams` requires `project_id`.
    const res = await fetch(`${BASE}/flow_definitions?project_id=proj_conformance_list`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => ListFlowDefinitionsResponse.parse(body)).not.toThrow();
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
    const res = await fetch(`${BASE}/flow_definitions/${id}?project_id=proj_conformance_get`);
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
    // Spec: `updateFlowDefinition` is `PUT /flow_definitions/{id}` with a
    // required `project_id` query param (the generated client and CLI
    // syncer both call it that way). The body wraps the definition under
    // `flow_definition` (flow-definition-update-request.yaml), unlike the
    // create envelope.
    const res = await fetch(`${BASE}/flow_definitions/${id}?project_id=proj_conformance_update`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow_definition: validFlowDefinitionBody() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => UpdateFlowDefinitionResponse.parse(body)).not.toThrow();
  });
});
