import { resetPlatformStore, setupPlatformHandlers } from "@zitadel-nextgen/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPlatformClient } from "../../src/platform";

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
    const { id } = await client.createSchema({ type: "object" });
    expect(id).toBeTruthy();
    await expect(client.deleteSchema(id)).resolves.toBeUndefined();
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

  it("listFlowDefinitions and getFlowDefinition expose detail responses", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const { id } = await client.createFlowDefinition({
      project_id: "proj_test",
      flow_definition: { name: "default" },
    });

    const single = await fetch(new URL(`/flow_definitions/${id}`, MOCK_SERVER_URL));
    expect(single.status).toBe(200);
    expect(await single.json()).toMatchObject({
      id,
      project_id: expect.any(String),
      schema_uri: expect.any(String),
      status: "active",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });

    const list = await fetch(new URL("/flow_definitions", MOCK_SERVER_URL));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      flow_definitions: [expect.objectContaining({ id })],
    });
  });

});
