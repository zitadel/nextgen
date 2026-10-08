import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import { materializeSetupResources } from "../../../src/lib/setup-resources";
import { IDPS_DIR } from "../../../src/lib/idp";
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
      // `GET /schemas/{id}` serves the `{id, schema, metadata}` envelope;
      // write-back must unwrap the document before it reaches disk.
      getSchemaById: vi.fn().mockResolvedValue({
        id: "sch_01KWHF",
        schema: canonical,
        metadata: { created_at: "2026-01-01T00:00:00Z" },
      }),
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

  // Setup reconciliation used to pre-encode the created schema's id. The
  // generated client owns the encoding now (#1272), so pre-encoding here sent
  // `%25` for every delimiter in a `$id` URL and the fetch 404'd.
  it("fetches the created schema by its id verbatim, leaving encoding to the client", async () => {
    const id = "https://nextgen.com/api/schemas/default-human-user.json";
    const getSchemaById = vi.fn().mockResolvedValue({
      id,
      schema: { objectType: "human-user", kind: "user-schema", title: "T" },
      metadata: { created_at: "2026-01-01T00:00:00Z" },
    });
    const client = {
      createSchema: vi.fn().mockResolvedValue({ id }),
      getSchemaById,
      createFlowDefinition: vi.fn().mockResolvedValue({ id: "flow_01KWHG", status: "active" }),
    } as unknown as ZitadelClient;

    await materializeSetupResources({
      cwd,
      client,
      projectId: "project_123",
      force: false,
      cliVersion: TEST_CLI_VERSION,
    });

    expect(getSchemaById).toHaveBeenCalledWith(id);
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
  const google = [{ provider: "google", clientId: "1234-abc.apps.googleusercontent.com" }];

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

  it("refuses to write back a connection the server returned with a secret value", async () => {
    // The write-back commits the canonical body to `.zitadel/idps/`, so a
    // resolved secret must stop here rather than reach a committed file.
    const client = recordingClient();
    const leaking = {
      ...client,
      createIdp: () =>
        Promise.resolve({
          id: "idp_1",
          revision_id: "idprev_1",
          slug: "google",
          definition: {
            slug: "google",
            protocol: "oidc",
            oidc: { issuer: "https://accounts.google.com", client_secret: "GOCSPX-real" },
          },
        }),
    } as unknown as typeof client;

    await expect(
      materializeSetupResources({
        cwd,
        cliVersion: TEST_CLI_VERSION,
        client: leaking,
        projectId: "project_123",
        force: false,
        sso: google,
      }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });

    const written = existsSync(join(cwd, IDPS_DIR, "google.json"))
      ? await readFile(join(cwd, IDPS_DIR, "google.json"), "utf8")
      : "";
    expect(written).not.toContain("GOCSPX-real");
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

/**
 * Cardinality greater than one, which the catalog cannot supply today: it
 * registers Google alone (`packages/config/src/idp/index.ts`). Mocking the
 * lookup is the alternative to a production seam that exists only for tests —
 * the loops under test take whatever `idpProvider` returns, so two distinct
 * fakes exercise them exactly as two real providers would.
 */
describe("materializeSetupResources with several providers", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-multi-"));
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {} }),
    );
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("@zitadel/config/idp");
    vi.resetModules();
    await rm(cwd, { recursive: true, force: true });
  });

  it("creates a connection per provider and names every slug", async () => {
    const actual =
      await vi.importActual<typeof import("@zitadel/config/idp")>("@zitadel/config/idp");
    const google = actual.idpProvider("google");
    // Two providers differing only in slug and display name: enough for the
    // loops, and the connection body stays a real one the contract accepts.
    vi.doMock("@zitadel/config/idp", () => ({
      ...actual,
      IDP_PROVIDERS: ["google", "acme"],
      idpProvider: (slug: string) => ({
        ...google,
        slug,
        displayName: slug === "acme" ? "Acme SSO" : "Google",
        connection: (input: Parameters<typeof google.connection>[0]) => ({
          ...(google.connection(input) as Record<string, unknown>),
          slug,
          display_name: slug === "acme" ? "Acme SSO" : "Google",
        }),
      }),
    }));

    const { materializeSetupResources: materialize } = await import(
      "../../../src/lib/setup-resources"
    );
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

    await materialize({
      cwd,
      cliVersion: TEST_CLI_VERSION,
      client,
      projectId: "project_123",
      force: false,
      sso: [
        { provider: "google", clientId: "google-client-id" },
        { provider: "acme", clientId: "acme-client-id" },
      ],
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
