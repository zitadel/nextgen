import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { createZitadelClient } from "@zitadel/api/client";
import { DEFAULT_FLOW_SCHEMA_URI } from "@zitadel/config/defaults";

import { FLOWS_DIR } from "../../../../src/lib/flows";
import { SCHEMAS_DIR } from "../../../../src/lib/user-schema";
import { makeSyncers } from "../../../../src/lib/sync/syncers";
import { ZitadelError } from "../../../../src/lib/errors";

/**
 * The CLI now consumes the orval-generated client directly. Syncer
 * tests assert on what each method puts on the wire — bodies, URLs,
 * query strings — by intercepting the underlying `fetch` with msw,
 * rather than mocking a `PlatformClient` interface that no longer
 * exists.
 */
const BASE = "http://mock.zitadel.test";
const server = setupServer();
const client = createZitadelClient({ baseUrl: BASE });

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe("makeSyncers", () => {
  it("returns the schema and flow syncers in order", () => {
    const syncers = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    expect(syncers).toHaveLength(3);
    expect(syncers.map((s) => s.kind)).toEqual(["schema", "flow", "branding"]);
  });

  it("configures the schema syncer (immutable, SCHEMAS_DIR)", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    expect(schema.kind).toBe("schema");
    expect(schema.directory).toBe(SCHEMAS_DIR);
    expect(schema.mutable).toBe(false);
    expect(typeof schema.fetch).toBe("function");
  });

  it("configures the flow syncer (mutable, FLOWS_DIR)", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    expect(flow.kind).toBe("flow");
    expect(flow.directory).toBe(FLOWS_DIR);
    expect(flow.mutable).toBe(true);
    expect(typeof flow.fetch).toBe("function");
  });
});

describe("SchemaSyncer", () => {
  it("validate accepts a user-schema body with the required spec fields", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    expect(() =>
      schema.validate({
        kind: "user-schema",
        metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
        "x-auth-methods": { password: { enabled: true } },
        properties: { email: { type: "string" } },
      }),
    ).not.toThrow();
  });

  it("validate throws E_VALIDATION on a malformed JSON Schema", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    expect(() => schema.validate({ type: 123 })).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION when the kind discriminator is missing", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    expect(() => schema.validate({ type: "object" })).toThrow(ZitadelError);
  });

  it("create POSTs the bare body to /schemas with project_id on the query and returns the server id", async () => {
    let receivedUrl = "";
    let receivedBody: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/schemas`, async ({ request }) => {
        receivedUrl = request.url;
        receivedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "schema-id-1" }, { status: 201 });
      }),
      http.get(`${BASE}/schemas/schema-id-1`, () =>
        HttpResponse.json({ kind: "user-schema", version: 1 }),
      ),
    );
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    const data = { kind: "user-schema", version: 1 };

    const result = await schema.create(data);

    expect(result.id).toBe("schema-id-1");
    // The stored body comes from the follow-up fetch, feeding write-back.
    expect(result.canonical).toEqual({ kind: "user-schema", version: 1 });
    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
    expect(receivedBody).toEqual(data);
    expect(receivedBody.$id).toBeUndefined();
  });

  it("create degrades to no canonical body when the follow-up fetch fails", async () => {
    server.use(
      http.post(`${BASE}/schemas`, () =>
        HttpResponse.json({ id: "schema-id-2" }, { status: 201 }),
      ),
      http.get(`${BASE}/schemas/schema-id-2`, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    const result = await schema.create({ kind: "user-schema" });

    expect(result.id).toBe("schema-id-2");
    expect(result.canonical).toBeUndefined();
  });

  it("update throws E_NOT_IMPLEMENTED — schemas are revisioned, edits publish a new revision", async () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    await expect(schema.update("schema-id-1", { a: 1 })).rejects.toThrow(/revisioned/);
  });

  it("exposes revisioned=true — a schema-file hash change publishes a new revision", () => {
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    expect(schema.revisioned).toBe(true);
  });

  it("fetch dispatches GET /schemas/:id?project_id=... and returns the body", async () => {
    let receivedUrl = "";
    server.use(
      http.get(`${BASE}/schemas/schema-id-1`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ kind: "user-schema", version: 1 });
      }),
    );
    const [schema] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    const body = await schema.fetch?.("schema-id-1");

    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
    expect(body).toEqual({ kind: "user-schema", version: 1 });
  });
});

const VALID_FLOW = {
  name: "default",
  status: "active",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [{ name: "identifier", fields: [], actions: [], gates: {} }],
};

describe("FlowDefinitionSyncer", () => {
  it("validate accepts a well-formed flow definition", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    expect(() => flow.validate(VALID_FLOW)).not.toThrow();
  });

  it("validate throws E_VALIDATION on a malformed flow definition", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    expect(() => flow.validate({ version: 99, kind: "wrong" })).toThrow(ZitadelError);
  });

  const FLOW_WITH_ENV_REF = {
    ...VALID_FLOW,
    steps: [
      {
        ...VALID_FLOW.steps[0],
        gates: {
          captcha: {
            kind: "captcha",
            provider: "altcha",
            config: { client_secret_env: "MY_SECRET" },
          },
        },
      },
    ],
  };

  it("validate throws E_VALIDATION when a referenced env var is missing", () => {
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    expect(() => flow.validate(FLOW_WITH_ENV_REF)).toThrow(ZitadelError);
  });

  it("validate passes when the referenced env var is present", () => {
    const [, flow] = makeSyncers({
      client,
      projectId: "proj-1",
      env: { MY_SECRET: "hunter2" },
      cwd: "/tmp/zitadel-sync-test",
    });
    expect(() => flow.validate(FLOW_WITH_ENV_REF)).not.toThrow();
  });

  it("create POSTs the spec envelope `{project_id, schema_uri, flow_definition}` and returns the platform id", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/flow_definitions`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          { id: "flow-id-1", flow_definition: { name: "Default", audience: {} } },
          { status: 201 },
        );
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });
    const data = { name: "Default", status: "active", version: 2 };

    const result = await flow.create(data);

    expect(result.id).toBe("flow-id-1");
    // The response envelope's flow_definition is the canonical stored body.
    expect(result.canonical).toEqual({ name: "Default", audience: {} });
    expect(receivedBody).toEqual({
      project_id: "proj-1",
      schema_uri: DEFAULT_FLOW_SCHEMA_URI,
      flow_definition: data,
    });
  });

  it("update PUTs the `{flow_definition}` envelope with the project_id query param", async () => {
    let receivedBody: unknown;
    let receivedProjectId: string | null = null;
    server.use(
      http.put(`${BASE}/flow_definitions/flow-id-1`, async ({ request }) => {
        receivedProjectId = new URL(request.url).searchParams.get("project_id");
        receivedBody = await request.json();
        return HttpResponse.json({
          id: "flow-id-1",
          flow_definition: { status: "active", version: 3, audience: {} },
        });
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    const result = await flow.update("flow-id-1", { status: "active", version: 3 });

    expect(receivedProjectId).toBe("proj-1");
    expect(receivedBody).toEqual({ flow_definition: { status: "active", version: 3 } });
    expect(result.canonical).toEqual({ status: "active", version: 3, audience: {} });
  });

  it("delete DELETEs /flow_definitions/:id with the project_id query param", async () => {
    let hits = 0;
    let receivedProjectId: string | null = null;
    server.use(
      http.delete(`${BASE}/flow_definitions/flow-id-1`, ({ request }) => {
        receivedProjectId = new URL(request.url).searchParams.get("project_id");
        hits += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    await flow.delete("flow-id-1");

    expect(hits).toBe(1);
    expect(receivedProjectId).toBe("proj-1");
  });

  it("fetch unwraps the detail envelope and sends project_id", async () => {
    let receivedUrl = "";
    server.use(
      http.get(`${BASE}/flow_definitions/flow-id-1`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({
          id: "flow-id-1",
          project_id: "proj-1",
          flow_definition: {
            name: "Default",
            status: "active",
            version: 2,
          },
          created_at: "2026-01-01",
          updated_at: "2026-01-02",
        });
      }),
    );
    const [, flow] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd: "/tmp/zitadel-sync-test" });

    const body = await flow.fetch?.("flow-id-1");

    expect(new URL(receivedUrl).searchParams.get("project_id")).toBe("proj-1");
    expect(body).toEqual({ name: "Default", status: "active", version: 2 });
  });
});

describe("BrandingSyncer", () => {
  const VALID_TEMPLATE = `<div>{% for f in fields %}<zl-field name="{{ f.name }}"></zl-field>{% endfor %}{% mandatory_gates %}</div>`;

  /** A throwaway project dir with `.zitadel/branding/login.liquid` seeded. */
  async function makeBrandingProject(template = VALID_TEMPLATE): Promise<string> {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-branding-sync-"));
    await mkdir(join(cwd, ".zitadel/branding"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/branding/login.liquid"), template);
    return cwd;
  }

  const descriptor = {
    $schema: "../meta/branding.json",
    layout: "split",
    liquid_template_file: "./login.liquid",
    logo_url: "https://cdn.example.com/logo.svg",
  };

  it("configures the branding syncer (revisioned, BRANDING_DIR)", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    expect(branding.kind).toBe("branding");
    expect(branding.directory).toBe(".zitadel/branding");
    expect(branding.mutable).toBe(false);
    expect(branding.revisioned).toBe(true);
    expect(branding.singletonFile).toBe("branding.json");
  });

  it("validate accepts a descriptor whose referenced template is valid", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    expect(() => branding.validate(descriptor)).not.toThrow();
  });

  it("validate throws E_VALIDATION when the referenced template file is missing", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    expect(() =>
      branding.validate({ ...descriptor, liquid_template_file: "./missing.liquid" }),
    ).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION when the template file escapes the project", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    expect(() =>
      branding.validate({ ...descriptor, liquid_template_file: "../../../../etc/passwd" }),
    ).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION on a hostile template", async () => {
    const cwd = await makeBrandingProject(`<img src=x onerror=alert(1)>{% mandatory_gates %}`);
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    expect(() => branding.validate(descriptor)).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION when both template carriers are present", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    expect(() =>
      branding.validate({ ...descriptor, liquid_template: VALID_TEMPLATE }),
    ).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION on non-https asset URLs (server parity)", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    // apply mutates schemas and flows before branding, so plan must reject
    // exactly what the server's https-only gate would reject.
    const attempt = (): void =>
      branding.validate({ ...descriptor, logo_url: "http://cdn.example.com/logo.svg" });
    expect(attempt).toThrow(ZitadelError);
    try {
      attempt();
    } catch (error) {
      expect(JSON.stringify((error as ZitadelError).details)).toContain("https");
    }
  });

  it("validate rejects URLs the WHATWG parser forgives but Go's url.Parse rejects", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    // new URL() normalizes all of these into valid https URLs; the server's
    // Go parser rejects them — plan must be stricter-or-equal, never looser.
    for (const hostile of [
      "https:example.com",
      String.raw`https:\\cdn.example.com\logo.svg`,
      "https://cdn.example.com/logo .svg",
      " https://cdn.example.com/logo.svg",
    ]) {
      expect(
        () => branding.validate({ ...descriptor, logo_url: hostile }),
        `should reject ${JSON.stringify(hostile)}`,
      ).toThrow(ZitadelError);
    }
  });

  it("validate throws E_VALIDATION on unknown descriptor keys", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    // A typo like hero_urll would otherwise pass plan, be ignored by the
    // server, and vanish on canonical write-back.
    expect(() =>
      branding.validate({ ...descriptor, hero_urll: "https://cdn.example.com/hero.png" }),
    ).toThrow(ZitadelError);
  });

  it("validate throws E_VALIDATION on font_url (read-only in v1)", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    const attempt = (): void =>
      branding.validate({ ...descriptor, font_url: "https://fonts.example.com/css2" });
    expect(attempt).toThrow(ZitadelError);
    try {
      attempt();
    } catch (error) {
      expect(JSON.stringify((error as ZitadelError).details)).toContain("font_url");
    }
  });

  it("normalize inlines the template file so a .liquid edit changes the hash", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    const before = branding.normalize?.(descriptor) as { liquid_template?: string };
    expect(before.liquid_template).toBe(VALID_TEMPLATE);
    expect(before).not.toHaveProperty("$schema");
    expect(before).not.toHaveProperty("liquid_template_file");

    const edited = `<p data-edit="1">edited</p>{% mandatory_gates %}`;
    await writeFile(join(cwd, ".zitadel/branding/login.liquid"), edited);
    const after = branding.normalize?.(descriptor) as { liquid_template?: string };
    expect(after.liquid_template).toBe(edited);
  });

  it("create POSTs the inlined wire body and returns the canonical in file-ref form", async () => {
    const cwd = await makeBrandingProject();
    let receivedBody: unknown;
    let receivedProjectId: string | null = null;
    server.use(
      http.post(`${BASE}/branding`, async ({ request }) => {
        receivedProjectId = new URL(request.url).searchParams.get("project_id");
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            id: "brnd-1",
            created_at: "2026-07-20T00:00:00Z",
            branding: {
              layout: "split",
              liquid_template: VALID_TEMPLATE,
              logo_url: "https://cdn.example.com/logo.svg",
            },
          },
          { status: 201 },
        );
      }),
    );
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    const result = await branding.create(descriptor);

    expect(receivedProjectId).toBe("proj-1");
    expect(receivedBody).toEqual({
      layout: "split",
      liquid_template: VALID_TEMPLATE,
      logo_url: "https://cdn.example.com/logo.svg",
    });
    expect(result.id).toBe("brnd-1");
    expect(result.canonical).toEqual({
      layout: "split",
      liquid_template_file: "./login.liquid",
      logo_url: "https://cdn.example.com/logo.svg",
    });
  });

  it("create writes a differing canonical template back to the referenced file", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const cwd = await makeBrandingProject();
    const serverTemplate = `<p data-server="1">canonical</p>{% mandatory_gates %}`;
    server.use(
      http.post(`${BASE}/branding`, () =>
        HttpResponse.json(
          {
            id: "brnd-2",
            created_at: "2026-07-20T00:00:00Z",
            branding: { layout: "split", liquid_template: serverTemplate },
          },
          { status: 201 },
        ),
      ),
    );
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    await branding.create(descriptor);

    const onDisk = await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8");
    expect(onDisk).toBe(serverTemplate);
  });

  it("update and delete throw E_NOT_IMPLEMENTED (revisioned resource)", async () => {
    const cwd = await makeBrandingProject();
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    await expect(branding.update("brnd-1", descriptor)).rejects.toThrow(ZitadelError);
    await expect(branding.delete("brnd-1")).rejects.toThrow(ZitadelError);
  });

  it("fetch unwraps the revision envelope", async () => {
    const cwd = await makeBrandingProject();
    server.use(
      http.get(`${BASE}/branding/brnd-1`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("project_id")).toBe("proj-1");
        return HttpResponse.json({
          id: "brnd-1",
          created_at: "2026-07-20T00:00:00Z",
          branding: { layout: "centered", liquid_template: VALID_TEMPLATE },
        });
      }),
    );
    const [, , branding] = makeSyncers({ client, projectId: "proj-1", env: {}, cwd });

    const body = await branding.fetch?.("brnd-1");

    expect(body).toEqual({ layout: "centered", liquid_template: VALID_TEMPLATE });
  });
});
