import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";

import { bootstrapProject } from "../../src/bootstrap";

// Never resolved on the network: msw intercepts everything, and unhandled
// requests error out (a stray fetch would otherwise freeze sandboxed vitest).
const BASE = "http://zitadel-testing.invalid";

interface Captured {
  projectBody?: Record<string, unknown>;
  schemaBody?: Record<string, unknown>;
  schemaAuth?: string | null;
  flowBody?: Record<string, unknown>;
  flowAuth?: string | null;
}

const captured: Captured = {};

const server = setupServer(
  http.post(`${BASE}/projects`, async ({ request }) => {
    captured.projectBody = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        id: "proj_1",
        name: "zitadel-testing",
        project_secret: "secret_1",
        preview_secret: "preview_1",
        preview_origins: [],
        created_at: "2026-01-01T00:00:00Z",
      },
      { status: 201 },
    );
  }),
  http.post(`${BASE}/schemas`, async ({ request }) => {
    captured.schemaBody = (await request.json()) as Record<string, unknown>;
    captured.schemaAuth = request.headers.get("authorization");
    return HttpResponse.json({ id: "sch_1" }, { status: 201 });
  }),
  http.post(`${BASE}/flow_definitions`, async ({ request }) => {
    captured.flowBody = (await request.json()) as Record<string, unknown>;
    captured.flowAuth = request.headers.get("authorization");
    return HttpResponse.json({ id: "flowdef_1" }, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  for (const key of Object.keys(captured) as (keyof Captured)[]) {
    delete captured[key];
  }
});
afterAll(() => server.close());

describe("bootstrapProject", () => {
  it("creates project, schema, and flow in setup order", async () => {
    const result = await bootstrapProject({
      baseUrl: BASE,
      appOrigins: ["http://localhost:3002"],
    });

    expect(result).toEqual({
      projectId: "proj_1",
      projectSecret: "secret_1",
      previewSecret: "preview_1",
      schemaId: "sch_1",
      flowId: "flowdef_1",
    });

    expect(captured.projectBody).toMatchObject({
      name: "zitadel-testing",
      preview_origins: ["http://localhost:3002"],
      seed_defaults: false,
    });

    // Schema uploads without $id (the server assigns the opaque id) and with
    // the freshly minted project secret as bearer.
    expect(captured.schemaBody).not.toHaveProperty("$id");
    expect(captured.schemaBody).toMatchObject({ objectType: "human-user" });
    expect(captured.schemaAuth).toBe("Bearer secret_1");

    const flowDefinition = captured.flowBody?.flow_definition as Record<string, unknown>;
    expect(captured.flowBody).toMatchObject({
      project_id: "proj_1",
      schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    });
    expect(flowDefinition.user_schema).toBe("sch_1");
    expect(captured.flowAuth).toBe("Bearer secret_1");
  });

  it("propagates API errors with status", async () => {
    server.use(
      http.post(`${BASE}/projects`, () =>
        HttpResponse.json({ code: "req.invalid", message: "nope" }, { status: 400 }),
      ),
    );
    await expect(bootstrapProject({ baseUrl: BASE })).rejects.toMatchObject({ status: 400 });
  });

  it("fails clearly when the server omits the project secret", async () => {
    server.use(
      http.post(`${BASE}/projects`, () => HttpResponse.json({ id: "proj_1" }, { status: 201 })),
    );
    await expect(bootstrapProject({ baseUrl: BASE })).rejects.toThrow(/project secret/);
  });
});
