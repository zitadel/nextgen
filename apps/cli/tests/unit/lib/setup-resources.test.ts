import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeFlowBody,
  normalizeIdpBody,
  normalizeSchemaBody,
} from "@zitadel/config/normalize";

import {
  assertNoSetupResourceConflicts,
  materializeSetupResources,
} from "../../../src/lib/setup-resources";
import { IDPS_DIR } from "../../../src/lib/idp";
import { acmeSelection, googleSelection } from "../../helpers/idp-values";
import { FLOWS_DIR } from "../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../src/lib/user-schema";
import { stableStringify } from "../../../src/lib/json";
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

  it("names the schema by its objectType on the flow", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi
        .fn()
        .mockImplementation(async (body: { flow_definition: { user_schema: string } }) => ({
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

    const flowFile = JSON.parse(await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8")) as {
      user_schema: string;
    };
    expect(flowFile.user_schema).toBe("human-user");
  });

  it("keeps the schema file as written and seeds its hash from it", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockResolvedValue({
        id: "flow_01KWHG",
        status: "active",
      }),
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      cliVersion: TEST_CLI_VERSION,
    });

    const written = await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8");
    const posted = vi.mocked(client.createSchema).mock.calls[0]?.[0];
    expect(written).toBe(`${stableStringify(posted)}\n`);
    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[DEFAULT_SCHEMA_CONFIG_PATH]?.hash).toBe(
      hashForState({ normalize: normalizeSchemaBody }, JSON.parse(written) as object),
    );
  });

  it("keeps the server's empty audience echo out of the flow file and hashes past it", async () => {
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi
        .fn()
        .mockImplementation(async (body: { flow_definition: Record<string, unknown> }) => ({
          id: "flow_01KWHG",
          status: "active",
          flow_definition: { audience: {}, ...body.flow_definition },
        })),
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      cliVersion: TEST_CLI_VERSION,
    });

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
      createFlowDefinition: vi
        .fn()
        .mockImplementation(async (body: { flow_definition: Record<string, unknown> }) => ({
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
    const schemaBody = vi.mocked(client.createSchema).mock.calls[0]?.[0] as unknown as {
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
    const flowFile = JSON.parse(await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8")) as {
      steps: Array<{ name: string; fields?: string[] }>;
    };
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
      expect(readme).toContain(`npx @zitadel/cli@${TEST_CLI_VERSION} deploy`);
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

describe("materializeSetupResources branding", () => {
  it("never scaffolds branding files or publishes a branding revision (#1039)", async () => {
    const createBranding = vi.fn();
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi.fn().mockResolvedValue({ id: "flow_01KWHG" }),
      createBranding,
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      cliVersion: TEST_CLI_VERSION,
    });

    expect(createBranding).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, ".zitadel/branding"))).toBe(false);
    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(Object.keys(state.resources)).not.toContain(".zitadel/branding/branding.json");
  });
});

describe("materializeSetupResources with a social provider", () => {
  /**
   * A client that records what it was sent, echoing each create back so the
   * write-back path runs exactly as it does against a real server.
   */
  function recordingClient() {
    return {
      createIdp: vi.fn().mockImplementation(async (body: { idp: object }) => ({
        id: "idp_01KWHE",
        definition: body.idp,
      })),
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi
        .fn()
        .mockImplementation(async (body: { flow_definition: object }) => ({
          id: "flow_01KWHG",
          status: "active",
          flow_definition: body.flow_definition,
        })),
    } as unknown as ZitadelClient;
  }

  // A list now: setup enables any number of providers in one run.
  const google = [{ selection: googleSelection }];

  it("writes the connection and records the id the platform assigned", async () => {
    const client = recordingClient();

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      sso: google,
    });

    const connection = JSON.parse(await readFile(join(cwd, IDPS_DIR, "google.json"), "utf8")) as {
      slug: string;
      oidc: { client_id: string; client_secret: string };
    };
    expect(connection.slug).toBe("google");
    // A reference, not the prompted value: the id is published as an ordinary
    // project variable so one connection file serves every environment.
    expect(connection.oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
    // The value never reaches the file, only the reference the platform
    // resolves from its variables.
    expect(connection.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");

    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[`${IDPS_DIR}/google.json`]).toMatchObject({ id: "idp_01KWHE" });
  });

  it("writes the connection it uploaded, whatever the server stored", async () => {
    // The server spells out defaults the file leaves to it, and a server that
    // resolved the secret would hand back a credential: neither reaches the
    // committed file, which holds what setup uploaded and nothing else.
    const client = recordingClient();
    const createIdp = vi.fn().mockImplementation(async ({ idp }: { idp: object }) => ({
      id: "idp_1",
      revision_id: "idprev_1",
      slug: "google",
      definition: {
        ...idp,
        oidc: {
          ...(idp as { oidc: object }).oidc,
          client_secret: "GOCSPX-real",
          pkce_enabled: true,
          token_endpoint_auth_method: "client_secret_basic",
        },
      },
    }));

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client: { ...client, createIdp } as unknown as typeof client,
      projectId: "project_123",
      force: false,
      sso: google,
    });

    const written = await readFile(join(cwd, IDPS_DIR, "google.json"), "utf8");
    expect(written).toBe(`${stableStringify(createIdp.mock.calls[0]?.[0].idp)}\n`);
    expect(written).not.toContain("GOCSPX-real");
    expect(written).not.toContain("pkce_enabled");
  });

  it("records the hash plan computes for the connection file", async () => {
    const client = recordingClient();

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      sso: google,
    });

    const file = JSON.parse(await readFile(join(cwd, IDPS_DIR, "google.json"), "utf8")) as object;
    const state = JSON.parse(
      await readFile(join(cwd, ".zitadel/state.json"), "utf8"),
    ) as ZitadelState;
    expect(state.resources[`${IDPS_DIR}/google.json`]?.hash).toBe(
      hashForState({ normalize: normalizeIdpBody }, file),
    );
  });

  it("leaves no connection file behind when the create fails", async () => {
    // Setup does not remove a connection file it wrote, so writing before the
    // create would leave one behind on any failure and the retry would refuse
    // on it -- with nothing able to clear it but the developer.
    const client = recordingClient();
    const failing = {
      ...client,
      createIdp: () => Promise.reject(new Error("not implemented")),
    } as unknown as typeof client;

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client: failing,
        projectId: "project_123",
        force: false,
        sso: google,
      }),
    ).rejects.toThrow();

    expect(existsSync(join(cwd, IDPS_DIR, "google.json"))).toBe(false);
  });

  it("refuses an existing connection before creating anything", async () => {
    // Finding out after the create would leave the project holding a
    // connection that no local file tracks.
    let created = false;
    const client = recordingClient();
    const watching = {
      ...client,
      createIdp: (...args: unknown[]) => {
        created = true;
        return (client.createIdp as (...a: unknown[]) => unknown)(...args);
      },
    } as unknown as typeof client;
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(join(cwd, IDPS_DIR, "google.json"), JSON.stringify({ slug: "google" }));

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client: watching,
        projectId: "project_123",
        force: false,
        sso: google,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });

    expect(created).toBe(false);
  });

  it("refuses to replace an existing connection, even with --force", async () => {
    // --force is for setup's own scaffolding. A connection may hold a client
    // id someone registered with the vendor and a slug the schemas and flows
    // already name, and the IdP contract makes these files tenant-owned.
    const client = recordingClient();
    const existing = `${IDPS_DIR}/google.json`;
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(join(cwd, existing), JSON.stringify({ slug: "google", mine: true }));

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client,
        projectId: "project_123",
        force: true,
        sso: google,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });

    const kept = JSON.parse(await readFile(join(cwd, existing), "utf8")) as { mine?: boolean };
    expect(kept.mine).toBe(true);
  });

  it("does not read the connection files when no provider was chosen", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(join(cwd, IDPS_DIR, "draft.json"), "{not json");

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client: recordingClient(),
        projectId: "project_123",
        force: false,
      }),
    ).resolves.toBeDefined();
  });

  it("names setup's own slug flag when it refuses a connection to another issuer", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(
      join(cwd, IDPS_DIR, "acme.json"),
      JSON.stringify({ slug: "acme", oidc: { issuer: "https://sso.other.example" } }),
    );

    const error = await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client: recordingClient(),
      projectId: "project_123",
      force: false,
      sso: [{ selection: acmeSelection }],
    }).catch((err: unknown) => err);

    expect((error as { hint?: string }).hint).toContain("--sso-slug");
  });

  it("suggests enabling the provider that was chosen, not always Google", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(
      join(cwd, IDPS_DIR, "acme.json"),
      JSON.stringify({ slug: "acme", oidc: { issuer: "https://sso.acme.example" } }),
    );

    const error = await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client: recordingClient(),
      projectId: "project_123",
      force: false,
      sso: [{ selection: acmeSelection }],
    }).catch((err: unknown) => err);

    expect((error as { nextCommands?: string[] }).nextCommands?.[0]).toContain(
      "--provider custom --slug acme",
    );
  });

  it("refuses a connection another file already holds the slug of, before creating anything", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(
      join(cwd, IDPS_DIR, "elsewhere.json"),
      JSON.stringify({ slug: "google", template: "google" }),
    );

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client: recordingClient(),
        projectId: "project_123",
        force: false,
        sso: google,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("refuses a custom connection whose variables another file would share", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(
      join(cwd, IDPS_DIR, "other.json"),
      JSON.stringify({
        slug: "other",
        oidc: {
          issuer: "https://other.example",
          client_id: "${{ ACME_CLIENT_ID }}",
          client_secret: "${{ OTHER_CLIENT_SECRET }}",
        },
      }),
    );

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client: recordingClient(),
        projectId: "project_123",
        force: false,
        sso: [{ selection: acmeSelection }],
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  // Setup does not remove a connection file it wrote, so a schema refused
  // after the connection exists would leave a file the retry refuses on.
  it("refuses an existing default schema before it creates the connection", async () => {
    const client = recordingClient();
    await mkdir(join(cwd, SCHEMAS_DIR), { recursive: true });
    await writeFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "{}\n");

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client,
        projectId: "project_123",
        force: false,
        sso: google,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });

    expect(client.createIdp).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, IDPS_DIR, "google.json"))).toBe(false);
  });

  it("creates the connection before the flow that names it", async () => {
    const client = recordingClient();

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      sso: google,
    });

    const idpCall = vi.mocked(client.createIdp).mock.invocationCallOrder[0] ?? Infinity;
    const flowCall = vi.mocked(client.createFlowDefinition).mock.invocationCallOrder[0] ?? 0;
    expect(idpCall).toBeLessThan(flowCall);
  });

  it("enables the provider on the published schema and login flow", async () => {
    const client = recordingClient();

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      sso: google,
    });

    const schema = JSON.parse(await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8")) as {
      "x-auth-methods": { sso?: { enabled: boolean; providers: string[] } };
    };
    expect(schema["x-auth-methods"].sso).toEqual({ enabled: true, providers: ["google"] });

    const flow = JSON.parse(await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8")) as {
      steps: Array<{ name: string; sso_providers?: string[] }>;
    };
    const entry = flow.steps.find((step) => step.name === "identifier");
    expect(entry?.sso_providers).toEqual(["google"]);
    expect(flow.steps.map((step) => step.name)).toEqual(
      expect.arrayContaining(["register-sso", "sso-conflict"]),
    );
  });

  it("leaves the schema and flow untouched when no provider was chosen", async () => {
    const client = recordingClient();

    await materializeSetupResources({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
    });

    const schema = JSON.parse(await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8")) as {
      "x-auth-methods": { sso?: unknown };
    };
    expect(schema["x-auth-methods"].sso).toBeUndefined();
    expect(client.createIdp).not.toHaveBeenCalled();
  });
});

/** Several providers at once: Google from the catalog, and a custom connection beside it. */
describe("materializeSetupResources with several providers", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-multi-"));
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {} }),
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("creates a connection per provider and names every slug", async () => {
    const client = {
      createIdp: vi.fn().mockImplementation(async (body: { idp: { slug?: string } }) => ({
        // A distinct id per connection, so a first-only bug cannot hide behind
        // one shared id in the state file.
        id: `idp_${String(body.idp.slug)}`,
        definition: body.idp,
      })),
      createSchema: vi.fn().mockResolvedValue({ id: "sch_01KWHF" }),
      createFlowDefinition: vi
        .fn()
        .mockImplementation(async (body: { flow_definition: object }) => ({
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
      sso: [{ selection: googleSelection }, { selection: acmeSelection }],
    });

    // One create and one file each, not just the first.
    expect(vi.mocked(client.createIdp).mock.calls).toHaveLength(2);
    expect(existsSync(join(cwd, IDPS_DIR, "google.json"))).toBe(true);
    expect(existsSync(join(cwd, IDPS_DIR, "acme.json"))).toBe(true);

    // Both slugs reach the schema and the flow, in the order chosen.
    const schema = JSON.parse(await readFile(join(cwd, DEFAULT_SCHEMA_CONFIG_PATH), "utf8")) as {
      "x-auth-methods": { sso?: { providers: string[] } };
    };
    expect(schema["x-auth-methods"].sso?.providers).toEqual(["google", "acme"]);

    const flow = JSON.parse(await readFile(join(cwd, DEFAULT_FLOW_CONFIG_PATH), "utf8")) as {
      steps: Array<{ name: string; sso_providers?: string[] }>;
    };
    const identifier = flow.steps.find((step) => step.name === "identifier");
    expect(identifier?.sso_providers).toEqual(["google", "acme"]);
  });
});

/**
 * Setup runs this before it creates the project: a conflict found once the
 * project exists leaves the project behind, and the rerun's `.env.local`
 * keeps its id and secret.
 */
describe("assertNoSetupResourceConflicts", () => {
  it.each([DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH])(
    "refuses an existing %s without --force",
    async (path) => {
      await mkdir(join(cwd, dirname(path)), { recursive: true });
      await writeFile(join(cwd, path), "{}\n");

      await expect(assertNoSetupResourceConflicts({ cwd, force: false })).rejects.toMatchObject({
        code: "E_CONFLICT",
        message: `${path} already exists`,
        hint: expect.stringContaining("--force"),
      });
    },
  );

  it("lets --force replace the default schema and flow", async () => {
    for (const path of [DEFAULT_SCHEMA_CONFIG_PATH, DEFAULT_FLOW_CONFIG_PATH]) {
      await mkdir(join(cwd, dirname(path)), { recursive: true });
      await writeFile(join(cwd, path), "{}\n");
    }

    await expect(assertNoSetupResourceConflicts({ cwd, force: true })).resolves.toBe(undefined);
  });

  it("refuses an existing connection for a chosen provider, even with --force", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(
      join(cwd, IDPS_DIR, "google.json"),
      JSON.stringify({ slug: "google", template: "google" }),
    );

    await expect(
      assertNoSetupResourceConflicts({ cwd, force: true, sso: [{ selection: googleSelection }] }),
    ).rejects.toMatchObject({
      code: "E_CONFLICT",
      message: `${IDPS_DIR}/google.json already exists`,
      hint: expect.stringContaining("never replaces or removes one"),
    });
  });

  it("refuses a chosen provider whose slug another connection file holds, before the project exists", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(
      join(cwd, IDPS_DIR, "elsewhere.json"),
      JSON.stringify({ slug: "google", template: "google" }),
    );

    await expect(
      assertNoSetupResourceConflicts({ cwd, force: true, sso: [{ selection: googleSelection }] }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("ignores a connection for a provider nobody chose", async () => {
    await mkdir(join(cwd, IDPS_DIR), { recursive: true });
    await writeFile(join(cwd, IDPS_DIR, "google.json"), JSON.stringify({ slug: "google" }));

    await expect(assertNoSetupResourceConflicts({ cwd, force: false })).resolves.toBe(undefined);
  });
});
