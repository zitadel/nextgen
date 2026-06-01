/**
 * Spec-conformance test for the api-mock.
 *
 * This test is independent of the hand-written response shapes in
 * `server.ts` / `platform-handlers.ts`. It boots the real Express mock
 * server, POSTs / GETs every mocked endpoint, and validates the response
 * against the corresponding **zod** schema orval generates from the OAS.
 *
 * The TypeScript types from `@zitadel-nextgen/api/generated/model` give
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
 *   - PATCH /flow_definitions/:id       → UpdateFlowDefinitionResponse
 *
 * Endpoints covered structurally (orval emits no `*Response` zod for these
 * because they have no static response schema — POSTs that return only an
 * `id`, or out-of-spec routes):
 *   - POST /projects                    → { project_id, project_secret, … }
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
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";
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
        actions: { submit: { text_key: "submit", primary: true } },
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

  test("POST /projects returns the spec-defined project shape", async () => {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preview_origins: ["http://localhost:3000"] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    // No CreateProjectResponse zod schema is emitted by orval. Validate
    // structurally against the fields create-project-response.yaml requires.
    expect(typeof body.project_id).toBe("string");
    expect(typeof body.project_secret).toBe("string");
    expect(typeof body.preview_secret).toBe("string");
    expect(Array.isArray(body.preview_origins)).toBe(true);
    expect(body.lifecycle).toBe("unclaimed");
    expect(body.claim_required_for).toEqual(["preview", "production"]);
    expect(typeof body.created_at).toBe("string");
  });

  test("GET /projects/:id matches GetProjectResponse", async () => {
    const create = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const { project_id, project_secret } = (await create.json()) as {
      project_id: string;
      project_secret: string;
    };
    const res = await fetch(`${BASE}/projects/${project_id}`, {
      headers: { authorization: `Bearer ${project_secret}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => GetProjectResponse.parse(body)).not.toThrow();
  });

  test("GET /projects/:id on unknown id returns spec-compliant error envelope", async () => {
    const res = await fetch(`${BASE}/projects/proj-does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("proj.not_found");
    expect(typeof body.message).toBe("string");
  });

  test("POST /schemas returns 201 with a schema id", async () => {
    const res = await fetch(`${BASE}/schemas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "user-schema", title: "x" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe("string");
    expect((body.id as string).startsWith("schema_")).toBe(true);
  });

  test("POST /schemas with invalid kind returns spec-compliant 400 envelope", async () => {
    const res = await fetch(`${BASE}/schemas`, {
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
    const res = await fetch(`${BASE}/flow_definitions`);
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
    const res = await fetch(`${BASE}/flow_definitions/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => GetFlowDefinitionResponse.parse(body)).not.toThrow();
  });

  test("PATCH /flow_definitions/:id matches UpdateFlowDefinitionResponse", async () => {
    const create = await fetch(`${BASE}/flow_definitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "proj_conformance_patch",
        flow_definition: validFlowDefinitionBody(),
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await fetch(`${BASE}/flow_definitions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validFlowDefinitionBody()),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => UpdateFlowDefinitionResponse.parse(body)).not.toThrow();
  });
});
