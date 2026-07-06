import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { createZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";

import { FLOWS_DIR } from "../../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../../src/lib/user-schema";
import { makeSyncers } from "../../../../src/lib/sync/syncers";
import { ZitadelError } from "../../../../src/lib/errors";

/**
 * The CLI now consumes the orval-generated client directly. Syncer
 * tests assert on what each method puts on the wire — bodies, URLs,
 * query strings — by intercepting the underlying `fetch` with msw,
 * rather than mocking a `PlatformClient` interface that no longer
 * exists.
 */
const BASE = "http://mock.zitadel.test";
const server = setupServer();
const client = createZitadelClient({ baseUrl: BASE });

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe("makeSyncers", () => {
  it("returns the schema and flow syncers in order", () => {
    const syncers = makeSyncers({ client, projectId: "proj-1", env: {} });

    expect(syncers).toHaveLength(2);
    expect(syncers.map((s) => s.kind)).toEqual(["schema", "flow"]);
  });

  it("configures the schema syncer (immutable, SCHEMAS_DIR)", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });

    expect(schema.kind).toBe("schema");
    expect(schema.directory).toBe(SCHEMAS_DIR);
    expect(schema.mutable).toBe(false);
    expect(typeof schema.fetch).toBe("function");
  });

  it("configures the flow syncer (mutable, FLOWS_DIR)", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });

    expect(flow.kind).toBe("flow");
    expect(flow.directory).toBe(FLOWS_DIR);
    expect(flow.mutable).toBe(true);
    expect(typeof flow.fetch).toBe("function");
  });
});

describe("SchemaSyncer", () => {
  it("validate accepts a user-schema body with the required spec fields", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });

    expect(() =>
      schema.validate({
        kind: "user-schema",
        metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
        "x-auth-methods": { password: { enabled: true, position: 0 } },
        properties: { email: { type: "string" } },
      }),
    ).not.toThrow();
  });

  it("validate throws E_VALIDATION on a malformed JSON Schema", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });

    expect(() => schema.validate({ type: 123 })).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION when the kind discriminator is missing", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });

    expect(() => schema.validate({ type: "object" })).toThrow(ZitadelError);
  });

  it("create POSTs the bare body to /schemas with project_id on the query and returns the server id", async () => {
    let receivedUrl = "";
    let receivedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/schemas`, async ({ request }) => {
        receivedUrl = request.url;
        receivedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "schema-id-1" }, { status: 201 });
      }),
    );
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });
    const data = { kind: "user-schema", version: 1 };

    const id = await schema.create(data);

    expect(id).toBe("schema-id-1");
    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
    expect(receivedBody).toEqual(data);
    expect(receivedBody.$id).toBeUndefined();
  });

  it("update throws E_NOT_IMPLEMENTED — schemas are revisioned, edits publish a new revision", async () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });
    await expect(schema.update("schema-id-1", { a: 1 })).rejects.toThrow(/revisioned/);
  });

  it("exposes revisioned=true — a schema-file hash change publishes a new revision", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });
    expect(schema.revisioned).toBe(true);
  });

  it("fetch dispatches GET /schemas/:id?project_id=... and returns the body", async () => {
    let receivedUrl = "";
    server.use(
      http.get(`${BASE}/schemas/schema-id-1`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ kind: "user-schema", version: 1 });
      }),
    );
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {} });

    const body = await schema.fetch?.("schema-id-1");

    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
    expect(body).toEqual({ kind: "user-schema", version: 1 });
  });
});

const VALID_FLOW = {
  name: "default",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [{ name: "identifier", fields: [], actions: [], gates: {} }],
};

describe("FlowDefinitionSyncer", () => {
  it("validate accepts a well-formed flow definition", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });
    expect(() => flow.validate(VALID_FLOW)).not.toThrow();
  });

  it("validate throws E_VALIDATION on a malformed flow definition", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });
    expect(() => flow.validate({ version: 99, kind: "wrong" })).toThrow(ZitadelError);
  });

  const FLOW_WITH_ENV_REF = {
    ...VALID_FLOW,
    steps: [
      {
        ...VALID_FLOW.steps[0],
        gates: {
          captcha: {
            kind: "captcha",
            provider: "altcha",
            config: { client_secret_env: "MY_SECRET" },
          },
        },
      },
    ],
  };

  it("validate throws E_VALIDATION when a referenced env var is missing", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });
    expect(() => flow.validate(FLOW_WITH_ENV_REF)).toThrow(ZitadelError);
  });

  it("validate passes when the referenced env var is present", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: { MY_SECRET: "hunter2" } });
    expect(() => flow.validate(FLOW_WITH_ENV_REF)).not.toThrow();
  });

  it("create POSTs the spec envelope `{project_id, schema_uri, flow_definition}` and returns the platform id", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/flow_definitions`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ id: "flow-id-1" }, { status: 201 });
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });
    const data = { name: "Default", version: 2 };

    const id = await flow.create(data);

    expect(id).toBe("flow-id-1");
    expect(receivedBody).toEqual({
      project_id: "proj-1",
      schema_uri: DEFAULT_FLOW_SCHEMA_URI,
      flow_definition: data,
    });
  });

  it("update PUTs the `{flow_definition}` envelope with the project_id query param", async () => {
    let receivedBody: unknown;
    let receivedProjectId: string | null = null;
    server.use(
      http.put(`${BASE}/flow_definitions/flow-id-1`, async ({ request }) => {
        receivedProjectId = new URL(request.url).searchParams.get("project_id");
        receivedBody = await request.json();
        return HttpResponse.json({});
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });

    await flow.update("flow-id-1", { version: 3 });

    expect(receivedProjectId).toBe("proj-1");
    expect(receivedBody).toEqual({ flow_definition: { version: 3 } });
  });

  it("delete DELETEs /flow_definitions/:id with project_id", async () => {
    let receivedUrl = "";
    server.use(
      http.delete(`${BASE}/flow_definitions/flow-id-1`, ({ request }) => {
        receivedUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });

    await flow.delete("flow-id-1");

    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
  });

  it("fetch unwraps the detail envelope and sends project_id", async () => {
    let receivedUrl = "";
    server.use(
      http.get(`${BASE}/flow_definitions/flow-id-1`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({
          id: "flow-id-1",
          project_id: "proj-1",
          schema_uri: "https://example/schema",
          status: "active",
          flow_definition: {
            name: "Default",
            version: 2,
          },
          created_at: "2026-01-01",
          updated_at: "2026-01-02",
        });
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {} });

    const body = await flow.fetch?.("flow-id-1");

    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
    expect(body).toEqual({ name: "Default", version: 2 });
  });
});
