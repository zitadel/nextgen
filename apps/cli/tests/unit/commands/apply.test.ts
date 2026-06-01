import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const BASE = "http://mock.zitadel.test";
const server = setupServer();

const VALID_FLOW = {
  // Spec: `name` is a slug-pattern stable identifier; required fields are
  // [name, user_schema, purposes, steps]. `purposes` is a map from
  // purpose name to entry-point step name.
  name: "default",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: [],
      actions: {},
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

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterAll(() => server.close());

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
  server.resetHandlers();
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

  it("fails with E_CLAIM_REQUIRED before preview mutations when the project is unclaimed", async () => {
    const cwd = await makeCwd({});
    server.use(
      http.get(`${BASE}/projects/proj-001`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer sk_proj_test");
        return HttpResponse.json({
          project_id: "proj-001",
          lifecycle: "unclaimed",
          preview_origins: [],
          claim_required_for: ["preview", "production"],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    const res = await runCliForTest([
      "apply",
      "--cwd",
      cwd,
      "--json",
      "--server",
      BASE,
      "--environment",
      "preview",
    ]);

    expect(res.exitCode).toBe(6);
    const json = parseJson(res.stdout) as { status: string; code: string; next_commands?: string[] };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CLAIM_REQUIRED");
    expect(json.next_commands).toEqual(["zitadel claim"]);
  });
});
