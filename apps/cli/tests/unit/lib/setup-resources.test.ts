import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
} from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materializeSetupResources } from "../../../src/lib/setup-resources";
import { FLOWS_DIR } from "../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../src/lib/user-schema";
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
  it("writes the schema and a flow that references it by handle, uploading nothing", async () => {
    await materializeSetupResources({ cwd, cliVersion: TEST_CLI_VERSION, force: false });

    const schemaFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8"),
    ) as { objectType: string; $id?: string };
    expect(schemaFile.objectType).toBe("human-user");
    // The server assigns the schema id when the first release is built.
    expect(schemaFile).not.toHaveProperty("$id");

    const flowFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8"),
    ) as { user_schema: string };
    // The handle, not a revision id: the release constructor resolves it,
    // so the same files deploy to any project.
    expect(flowFile.user_schema).toBe("human-user");

    // No revisions exist yet, so state stays empty until the first release.
    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources).toEqual({});
  });

  it("refuses to overwrite an existing resource file without --force", async () => {
    await mkdir(join(cwd, SCHEMAS_DIR), { recursive: true });
    await writeFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "{}\n");

    await expect(
      materializeSetupResources({ cwd, cliVersion: TEST_CLI_VERSION, force: false }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });

    await materializeSetupResources({ cwd, cliVersion: TEST_CLI_VERSION, force: true });
    const schemaFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8"),
    ) as { objectType: string };
    expect(schemaFile.objectType).toBe("human-user");
  });

  it("scaffolds the business use case's companyName into the written schema and register step", async () => {
    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      force: false,
      useCase: "business",
    });

    const schemaFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8"),
    ) as { properties: Record<string, unknown>; required: string[] };
    expect(schemaFile.properties).toHaveProperty("companyName");
    expect(schemaFile.required).toEqual(["email"]);

    // The register step's fields are derived from the same use case.
    const flowFile = JSON.parse(
      await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8"),
    ) as { steps: Array<{ name: string; fields?: string[] }> };
    const register = flowFile.steps.find((step) => step.name === "register");
    expect(register?.fields).toEqual(["email", "givenName", "familyName", "companyName"]);
  });

  it("writes schemas and flows READMEs the first time", async () => {
    const result = await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
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

    const result = await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      force: false,
    });

    const schemasReadme = await readFile(join(cwd, SCHEMAS_DIR, "README.md"), "utf8");
    expect(schemasReadme).toBe("# custom README\n");
    expect(result.filesWritten).not.toContain(join(cwd, SCHEMAS_DIR, "README.md"));
  });
});

describe("materializeSetupResources branding design", () => {
  it("scaffolds the design files with the template as a file reference", async () => {
    const { DEFAULT_BRANDING_CONFIG_PATH, DEFAULT_BRANDING_TEMPLATE_PATH, getDefaultBrandingConfig } =
      await import("@zitadel/config/defaults");

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      force: false,
      design: "split",
    });

    const descriptor = JSON.parse(
      await readFile(join(cwd, DEFAULT_BRANDING_CONFIG_PATH), "utf8"),
    ) as Record<string, unknown>;
    expect(descriptor.$schema).toBe("../meta/branding.json");
    expect(descriptor.layout).toBe("split");
    expect(descriptor.liquid_template).toEqual({ $file: "./login.liquid" });

    const template = await readFile(join(cwd, DEFAULT_BRANDING_TEMPLATE_PATH), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("split").template);

    const brandingReadme = await readFile(join(cwd, ".zitadel/branding/README.md"), "utf8");
    expect(brandingReadme).toContain(`npx @zitadel/cli@${TEST_CLI_VERSION} plan`);
    expect(brandingReadme).not.toMatch(/`zitadel /);
  });

  it("scaffolds no branding files when no design is chosen", async () => {
    await materializeSetupResources({ cwd, cliVersion: TEST_CLI_VERSION, force: false });

    await expect(readFile(join(cwd, ".zitadel/branding/branding.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
