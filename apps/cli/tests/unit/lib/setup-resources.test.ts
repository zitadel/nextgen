import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
} from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import { materializeSetupResources } from "../../../src/lib/setup-resources";
import { FLOWS_DIR } from "../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../src/lib/user-schema";
import { hashForState } from "../../../src/lib/sync";
import type { ZitadelState } from "../../../src/lib/sync/types";

const TEST_CLI_VERSION = "0.1.0-alpha.18";

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
        cliVersion: TEST_CLI_VERSION,
        client,
        projectId: "project_123",
        force: false,
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

  it("reuses the server-returned schema id as user_schema on the flow", async () => {
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
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
    });

    const flowFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8"),
    ) as { user_schema: string };
    expect(flowFile.user_schema).toBe("sch_01KWHF");
  });

  it("reconciles the schema file with the server's stored body and seeds its hash", async () => {
    const canonical = {
      objectType: "human-user",
      kind: "user-schema",
      title: "ServerCanonicalTitle",
      properties: { email: { type: "string", "x-audit": false } },
    };
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      getSchemaById: vi.fn().mockResolvedValue(canonical),
      createFlowDefinition: vi.fn().mockResolvedValue({
        id: "flow_01KWHG",
        status: "active",
      }),
    } as unknown as ZitadelClient;

    await materializeSetupResources({ cwd, client, projectId: "project_123", force: false, cliVersion: TEST_CLI_VERSION });

    const schemaFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8"),
    ) as Record<string, unknown>;
    // The file holds the server's stored body VERBATIM: the server keeps
    // schema bytes as uploaded, so a spelled-out meta-schema default must
    // survive write-back or the next revision would publish without it.
    expect(schemaFile.title).toBe("ServerCanonicalTitle");
    expect(schemaFile.properties).toEqual({ email: { type: "string", "x-audit": false } });

    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[DEFAULT_SCHEMA_CONFIG_PATH]?.hash).toBe(
      hashForState({ normalize: normalizeSchemaBody }, schemaFile),
    );
  });

  it("keeps the server's empty audience echo out of the flow file and hashes past it", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockImplementation(async (body: {
        flow_definition: Record<string, unknown>;
      }) => ({
        id: "flow_01KWHG",
        status: "active",
        flow_definition: { audience: {}, ...body.flow_definition },
      })),
    } as unknown as ZitadelClient;

    await materializeSetupResources({ cwd, client, projectId: "project_123", force: false, cliVersion: TEST_CLI_VERSION });

    const flowFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8"),
    ) as Record<string, unknown>;
    expect(flowFile).not.toHaveProperty("audience");

    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[DEFAULT_FLOW_CONFIG_PATH]?.hash).toBe(
      hashForState({ normalize: normalizeFlowBody }, flowFile),
    );
  });

  it("scaffolds the business use case's companyName into the written schema and register step", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockImplementation(async (body: {
        flow_definition: Record<string, unknown>;
      }) => ({
        id: "flow_01KWHG",
        status: "active",
        flow_definition: body.flow_definition,
      })),
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      useCase: "business",
    });

    // The composed schema field set reaches the uploaded body and the written
    // file — this is the one seam the config-package matrix can't cover.
    const schemaBody = vi.mocked(client.createSchema).mock.calls[0]?.[0] as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schemaBody.properties).toHaveProperty("companyName");
    expect(schemaBody.required).toEqual(["email"]);

    const schemaFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8"),
    ) as { properties: Record<string, unknown> };
    expect(schemaFile.properties).toHaveProperty("companyName");

    // The register step's fields are derived from the same use case.
    const flowFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8"),
    ) as { steps: Array<{ name: string; fields?: string[] }> };
    const register = flowFile.steps.find((step) => step.name === "register");
    expect(register?.fields).toEqual(["email", "givenName", "familyName", "companyName"]);
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
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
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
    // The bare `zitadel` command doesn't exist in a scaffolded app (the CLI
    // is not one of its dependencies) — every command mention must be the
    // runnable public npx form.
    for (const readme of [schemasReadme, flowsReadme]) {
      expect(readme).toContain(`npx @zitadel/cli@${TEST_CLI_VERSION} plan`);
      expect(readme).not.toMatch(/`zitadel /);
    }
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
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
    });

    const schemasReadme = await readFile(join(cwd, SCHEMAS_DIR, "README.md"), "utf8");
    expect(schemasReadme).toBe("# custom README\n");
    expect(result.filesWritten).not.toContain(join(cwd, SCHEMAS_DIR, "README.md"));
  });
});

describe("materializeSetupResources branding design", () => {
  it("scaffolds the design files and publishes branding revision 1", async () => {
    const { DEFAULT_BRANDING_CONFIG_PATH, DEFAULT_BRANDING_TEMPLATE_PATH, getDefaultBrandingConfig } =
      await import("@zitadel/config/defaults");
    const createBranding = vi.fn().mockResolvedValue({
      id: "brnd_01KWHH",
      created_at: "2026-07-20T00:00:00Z",
      branding: {},
    });
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockResolvedValue({ id: "flow_01KWHG" }),
      createBranding,
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      design: "split",
    });

    // The wire body carries the inlined template, not the file reference.
    const [wireBody, params] = createBranding.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(wireBody.layout).toBe("split");
    expect(String(wireBody.liquid_template)).toContain('class="zl-split"');
    expect(wireBody).not.toHaveProperty("liquid_template_file");
    expect(wireBody).not.toHaveProperty("$schema");
    expect(params).toEqual({ project_id: "project_123" });

    const descriptor = JSON.parse(
      await readFile(join(cwd, DEFAULT_BRANDING_CONFIG_PATH), "utf8"),
    ) as Record<string, unknown>;
    expect(descriptor.$schema).toBe("../meta/branding.json");
    expect(descriptor.liquid_template_file).toBe("./login.liquid");

    const template = await readFile(join(cwd, DEFAULT_BRANDING_TEMPLATE_PATH), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("split").template);

    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[DEFAULT_BRANDING_CONFIG_PATH]).toMatchObject({
      id: "brnd_01KWHH",
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const brandingReadme = await readFile(join(cwd, ".zitadel/branding/README.md"), "utf8");
    expect(brandingReadme).toContain(`npx @zitadel/cli@${TEST_CLI_VERSION} plan`);
    expect(brandingReadme).not.toMatch(/`zitadel /);
  });

  it("scaffolds no branding files when no design is chosen", async () => {
    const createBranding = vi.fn();
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockResolvedValue({ id: "flow_01KWHG" }),
      createBranding,
    } as unknown as ZitadelClient;

    await materializeSetupResources({ cwd, client, projectId: "project_123", force: false, cliVersion: TEST_CLI_VERSION });

    expect(createBranding).not.toHaveBeenCalled();
    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(Object.keys(state.resources)).not.toContain(".zitadel/branding/branding.json");
  });
});
