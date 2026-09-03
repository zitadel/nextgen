import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
  schema_version: 2,
};

const VALID_USER_SCHEMA = {
  kind: "user-schema",
  metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
  "x-identifier": "email",
  "x-auth-methods": { password: { enabled: true } },
  properties: { email: { type: "string", "x-unique": "project" } },
};

const VALID_FLOW = {
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

const tempDirs: string[] = [];

/**
 * A project whose state is empty, so every local resource is a fresh `create`
 * — `buildSyncPlan` needs no platform reads for create actions, so `plan` runs
 * fully offline here.
 */
async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-plan-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({ framework: "next", resources: {} }),
  );
  await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify(VALID_USER_SCHEMA));
  await writeFile(join(cwd, ".zitadel/flows/default.json"), JSON.stringify(VALID_FLOW));
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

describe("plan command", () => {
  it("summarizes the local resources as creates without mutating", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "plan",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "https://api.zitadel.cloud",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        creates: number;
        updates: number;
        revisions: number;
        deletes: number;
        total: number;
      };
    };
    expect(json.status).toBe("ok");
    // The user schema and the default flow are both new → two creates,
    // enumerated per resource in `changes` so agents can verify what a
    // plan will touch without applying.
    expect(json.data).toEqual({
      creates: 2,
      updates: 0,
      revisions: 0,
      deletes: 0,
      total: 2,
      changes: [
        { kind: "schema", action: "create", file: ".zitadel/schemas/user.json" },
        { kind: "flow", action: "create", file: ".zitadel/flows/default.json" },
      ],
      warnings: [],
    });
  });

  it("errors with E_VALIDATION when a local resource is invalid", async () => {
    const cwd = await makeProject();
    // `type` must be a string/array; a number makes the schema invalid, and the
    // sync engine validates every file before planning.
    await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify({ type: 123 }));

    const res = await runCliForTest([
      "plan",
      "--cwd",
      cwd,
      "--json",
      "--server",
      "https://api.zitadel.cloud",
    ]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
  });
});
