import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
} from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { materializeSetupResources } from "../../../src/lib/setup-resources";
import { FLOWS_DIR } from "../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../src/lib/user-schema";
import type { ZitadelState } from "../../../src/lib/sync/types";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-resources-"));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({
      framework: "next",
      resources: {},
    }),
  );
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("materializeSetupResources", () => {
  it("persists schema state before creating the flow so apply can recover partial setup", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockRejectedValue(new Error("flow create failed")),
    } as unknown as ZitadelClient;

    await expect(
      materializeSetupResources({
        cwd,
        client,
        projectId: "project_123",
        force: false,
        serverBaseUrl: "https://example.test",
      }),
    ).rejects.toThrow("flow create failed");

    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[DEFAULT_SCHEMA_CONFIG_PATH]).toMatchObject({
      id: "sch_01KWHF",
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("stamps the flow's user_schema with the resolved URL from the created schema id", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockImplementation(async (body: {
        flow_definition: { user_schema: string };
      }) => ({
        id: "flow_01KWHG",
        status: "active",
        flow_definition: body.flow_definition,
      })),
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      serverBaseUrl: "https://example.test",
    });

    const flowFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8"),
    ) as { user_schema: string };
    expect(flowFile.user_schema).toBe("https://example.test/api/schemas/sch_01KWHF");
  });

  it("writes schemas and flows READMEs the first time", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockResolvedValue({
        id: "flow_01KWHG",
        status: "active",
      }),
    } as unknown as ZitadelClient;

    const result = await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      serverBaseUrl: "https://example.test",
    });

    const schemasReadme = await readFile(join(cwd, SCHEMAS_DIR, "README.md"), "utf8");
    const flowsReadme = await readFile(join(cwd, FLOWS_DIR, "README.md"), "utf8");
    expect(schemasReadme).toContain("objectType");
    expect(flowsReadme).toContain("user_schema");
    expect(result.filesWritten).toEqual(
      expect.arrayContaining([
        join(cwd, SCHEMAS_DIR, "README.md"),
        join(cwd, FLOWS_DIR, "README.md"),
      ]),
    );
  });

  it("preserves an existing README so a developer's edits are not overwritten", async () => {
    await mkdir(join(cwd, SCHEMAS_DIR), { recursive: true });
    await writeFile(join(cwd, SCHEMAS_DIR, "README.md"), "# custom README\n");
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockResolvedValue({
        id: "flow_01KWHG",
        status: "active",
      }),
    } as unknown as ZitadelClient;

    const result = await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      serverBaseUrl: "https://example.test",
    });

    const schemasReadme = await readFile(join(cwd, SCHEMAS_DIR, "README.md"), "utf8");
    expect(schemasReadme).toBe("# custom README\n");
    expect(result.filesWritten).not.toContain(join(cwd, SCHEMAS_DIR, "README.md"));
  });
});
