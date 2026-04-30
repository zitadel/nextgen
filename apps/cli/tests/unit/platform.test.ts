import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MockPlatformClient } from "../../src/platform/mock-client";
import {
  configUploadResponseSchema,
  createProjectResponseSchema,
} from "../../src/platform/schemas";

describe("MockPlatformClient", () => {
  it("returns schema-valid project and config responses", async () => {
    const client = new MockPlatformClient();
    const project = await client.createProject({
      preview_origins: ["*.vercel.app"],
      slug_preference: "demo-app",
    });
    expect(createProjectResponseSchema.parse(project).schema_version).toBe(2);
    const upload = await client.uploadConfig(project.project_id, "development", {
      config: {
        project: project.project_id,
        environments: { development: { issuer: "http://localhost:3000" } },
      },
      hash: "sha256:test",
      schema_version: "2.0",
    });
    expect(configUploadResponseSchema.parse(upload).server_capabilities.features).toContain(
      "mock_platform",
    );
    expect((await client.getCapabilities()).features.config_apply).toBe(true);
  });

  it("keeps JSON fixtures schema-valid", async () => {
    const root = join(import.meta.dirname, "../../src/platform/fixtures");
    const createProject = JSON.parse(
      await readFile(join(root, "createProject.ok.json"), "utf8"),
    ) as unknown;
    const uploadConfig = JSON.parse(
      await readFile(join(root, "uploadConfig.ok.json"), "utf8"),
    ) as unknown;
    expect(createProjectResponseSchema.parse(createProject).schema_version).toBe(2);
    expect(
      configUploadResponseSchema.parse(uploadConfig).server_capabilities.flow_protocol_version,
    ).toBe("1.0");
  });
});
