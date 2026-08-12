import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const VALID_FLOW = {
  // Spec: `name` is a slug-pattern stable identifier; required fields are
  // [name, status, user_schema, purposes, steps]. `purposes` is a map from
  // purpose name to entry-point step name.
  name: "default",
  status: "active",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: [],
      actions: [],
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

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
  schema_version: 2,
};

const tempDirs: string[] = [];

async function makeCwd(flows: Record<string, object>): Promise<string> {
  const cwd = join(tmpdir(), `zitadel-apply-test-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({ framework: "next", resources: {} }),
  );
  for (const [name, contents] of Object.entries(flows)) {
    await writeFile(join(cwd, ".zitadel/flows", name), JSON.stringify(contents));
  }
  return cwd;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("apply command pre-flight", () => {
  it("errors with E_VALIDATION when a referenced env var is missing", async () => {
    const cwd = await makeCwd({ "default.json": VALID_FLOW });

    const res = await runCliForTest([
      "apply",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "https://api.zitadel.cloud",
    ]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; message: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("Missing environment variables");
  });
});

const VALID_USER_SCHEMA = {
  kind: "user-schema",
  metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
  "x-auth-methods": { password: { enabled: true } },
  properties: { email: { type: "string" } },
};

// VALID_FLOW deliberately references an env var for the pre-flight test
// above; the sync test needs a flow that passes validation as-is.
const SYNCABLE_FLOW = {
  name: "default",
  status: "active",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: [],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

/**
 * Minimal platform stub for one sync run: mints ids for schema and flow
 * creates, echoes the submitted flow back as its canonical body (so no
 * local write-back is needed), and 404s the schema canonical fetch (the
 * syncer degrades to no write-back by design).
 */
async function startPlatformStub(): Promise<string> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && path === "/schemas") {
      res
        .writeHead(201, { "content-type": "application/json" })
        .end(JSON.stringify({ id: "sch_test_1" }));
      return;
    }
    if (req.method === "POST" && path === "/flow_definitions") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        flow_definition: object;
      };
      res
        .writeHead(201, { "content-type": "application/json" })
        .end(JSON.stringify({ id: "flow_test_1", flow_definition: body.flow_definition }));
      return;
    }
    res
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ code: "not_found", message: "not found" }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("platform stub did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}

describe("apply command sync", () => {
  it("enumerates the applied resources with their platform ids", async () => {
    const cwd = await makeCwd({ "default.json": SYNCABLE_FLOW });
    await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify(VALID_USER_SCHEMA));
    const server = await startPlatformStub();

    const res = await runCliForTest(["apply", "--cwd", cwd, "--json", "--server", server]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        synced: boolean;
        changes: Array<Record<string, unknown>>;
        files_updated: string[];
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.synced).toBe(true);
    // `changes` names what happened on the platform, with resulting ids —
    // `files_updated` stays local write-backs only (none here: the stub
    // echoes the flow verbatim and the schema fetch degrades).
    expect(json.data.changes).toEqual([
      { kind: "schema", action: "create", file: ".zitadel/schemas/user.json", id: "sch_test_1" },
      { kind: "flow", action: "create", file: ".zitadel/flows/default.json", id: "flow_test_1" },
    ]);
    expect(json.data.files_updated).toEqual([]);
    expect(json.data.next_actions).toEqual([
      "Changes are live — reload your app to see them.",
      "Re-run plan to confirm local config and platform are in sync.",
    ]);
    expect(json.data.next_commands).toHaveLength(1);
    expect(json.data.next_commands[0]).toMatch(/^npx @zitadel\/cli@\S+ plan$/);
  });
});
