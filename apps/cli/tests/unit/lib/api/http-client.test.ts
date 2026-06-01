import { resetPlatformStore, setupPlatformHandlers } from "@zitadel-nextgen/api-mock/platform";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPlatformClient } from "../../../../src/lib/api";

const MOCK_SERVER_URL = "http://mock.zitadel.test";
const server = setupServer(...setupPlatformHandlers());
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); resetPlatformStore(); });

describe("platform client", () => {
  it("createProject returns a valid project with id and secrets", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const project = await client.createProject({ previewOrigins: ["*.vercel.app"] });
    expect(project.id).toBeTruthy();
    expect(project.projectSecret).toMatch(/^sk_proj_/);
    expect(project.previewSecret).toMatch(/^sk_proj_/);
    expect(project.previewOrigins).toEqual(["*.vercel.app"]);
    expect(project.createdAt).toBeTruthy();
  });

  it("getProject returns the created project", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const created = await client.createProject({ previewOrigins: [] });
    const fetched = await client.getProject(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.createdAt).toBeTruthy();
    expect(fetched.updatedAt).toBeTruthy();
  });

  it("createSchema and deleteSchema round-trip", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    // Spec: POST /schemas requires the `kind` discriminator
    // (`oneOf [user-schema, schema-url]`) and the `project_id` query param.
    const { id } = await client.createSchema(
      { kind: "user-schema", type: "object" },
      "proj_test",
    );
    expect(id).toBeTruthy();
    await expect(client.deleteSchema(id, "proj_test")).resolves.toBeUndefined();
  });

  it("createSchema rejects bodies missing the kind discriminator", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    await expect(client.createSchema({ type: "object" }, "proj_test")).rejects.toThrow(/400/);
  });

  it("createSchema rejects when the project_id query is missing (mirrors real backend)", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    // Passing the empty string forces the mock's project_id check to trip,
    // matching the real backend's required-query-param contract.
    await expect(
      client.createSchema({ kind: "user-schema", type: "object" }, ""),
    ).rejects.toThrow(/400/);
  });

  it("createSchema sends project_id as a query parameter on the URL", async () => {
    let observedUrl = "";
    server.use(
      http.post(/\/schemas/, ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({ id: "schema_x" }, { status: 201 });
      }),
    );
    const client = createPlatformClient(MOCK_SERVER_URL);
    await client.createSchema({ kind: "user-schema", type: "object" }, "proj_query_check");
    expect(new URL(observedUrl).searchParams.get("project_id")).toBe("proj_query_check");
  });

  it("createFlowDefinition, updateFlowDefinition, deleteFlowDefinition round-trip", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const { id } = await client.createFlowDefinition({
      project_id: "proj_test",
      flow_definition: { name: "default", purposes: ["login"] },
    });
    expect(id).toBeTruthy();
    // PATCH now returns 200 + flow-definition-detail-response per the spec
    // (was 204). The CLI client's typed return is `Promise<void>` and
    // discards the body, but the runtime value is the parsed envelope.
    await expect(
      client.updateFlowDefinition(id, { name: "default", purposes: ["login", "register"] }),
    ).resolves.toMatchObject({ id, project_id: "proj_test", status: "active" });
    await expect(client.deleteFlowDefinition(id)).resolves.toBeUndefined();
  });

  it("maps 401 responses to E_AUTH", async () => {
    server.use(http.get(/.*/, () => new HttpResponse(null, { status: 401 })));
    const client = createPlatformClient(MOCK_SERVER_URL);
    await expect(client.getProject("any")).rejects.toMatchObject({ code: "E_AUTH" });
  });

  it("maps 403 responses to E_AUTH", async () => {
    server.use(http.get(/.*/, () => new HttpResponse(null, { status: 403 })));
    const client = createPlatformClient(MOCK_SERVER_URL);
    await expect(client.getProject("any")).rejects.toMatchObject({ code: "E_AUTH" });
  });

  it("maps 5xx responses to E_NETWORK", async () => {
    server.use(http.get(/.*/, () => new HttpResponse(null, { status: 503 })));
    const client = createPlatformClient(MOCK_SERVER_URL);
    await expect(client.getProject("any")).rejects.toMatchObject({ code: "E_NETWORK" });
  });

  it("maps other 4xx responses to E_VALIDATION", async () => {
    server.use(http.get(/.*/, () => new HttpResponse(null, { status: 404 })));
    const client = createPlatformClient(MOCK_SERVER_URL);
    await expect(client.getProject("any")).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("getFlowDefinition returns the created flow definition", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const { id } = await client.createFlowDefinition({
      project_id: "proj_test",
      flow_definition: { name: "default" },
    });

    const flow = await client.getFlowDefinition(id);
    expect(flow).toMatchObject({
      id,
      project_id: "proj_test",
      schema_uri: expect.any(String),
      status: "active",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

});
