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
    const { id } = await client.createFlowDefinition({ version: 1, slug: "default" });
    expect(id).toBeTruthy();
    await expect(client.updateFlowDefinition(id, { version: 1, slug: "updated" })).resolves.toBeUndefined();
    await expect(client.deleteFlowDefinition(id)).resolves.toBeUndefined();
  });

  it("getCapabilities returns expected shape", async () => {
    const client = createPlatformClient(MOCK_SERVER_URL);
    const caps = await client.getCapabilities();
    expect(caps.mode).toBe("mock");
    expect(caps.features.config_apply).toBe(true);
  });
});
