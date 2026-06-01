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
    const project = await client.createProject({ preview_origins: ["*.vercel.app"] });
    expect(project.project_id).toBeTruthy();
    expect(project.project_secret).toMatch(/^sk_proj_/);
    expect(project.preview_secret).toMatch(/^sk_proj_/);
    expect(project.preview_origins).toEqual(["*.vercel.app"]);
    expect(project.lifecycle).toBe("unclaimed");
    expect(project.claim_required_for).toEqual(["preview", "production"]);
    expect(project.created_at).toBeTruthy();
  });

  it("getProject returns the created project", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const created = await client.createProject({ preview_origins: [] });
    const fetched = await client.getProject(created.project_id);
    expect(fetched.project_id).toBe(created.project_id);
    expect(fetched.lifecycle).toBe("unclaimed");
    expect(fetched.created_at).toBeTruthy();
    expect(fetched.updated_at).toBeTruthy();
  });

  it("createSchema and deleteSchema round-trip", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    // Spec: POST /schemas requires the `kind` discriminator
    // (`oneOf [user-schema, schema-url]`).
    const { id } = await client.createSchema({ kind: "user-schema", type: "object" });
    expect(id).toBeTruthy();
    await expect(client.deleteSchema(id)).resolves.toBeUndefined();
  });

  it("createSchema rejects bodies missing the kind discriminator", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    await expect(client.createSchema({ type: "object" })).rejects.toThrow(/400/);
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
