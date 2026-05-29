import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runApply } from "../../../src/commands/apply";
import type { GlobalOptions } from "../../../src/lib/oclif";

vi.mock("../../../src/lib/sync/loop", () => ({
  runSyncLoop: vi.fn().mockResolvedValue(undefined),
  buildSyncPlan: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/lib/api/index", () => ({
  createPlatformClient: vi.fn().mockReturnValue({}),
}));

const VALID_FLOW = {
  // Spec: `name` is a slug-pattern stable identifier; required fields are
  // [name, user_schema, purposes, initial_steps, steps].
  name: "default",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: ["login"],
  initial_steps: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      type: "identifier",
      fields: {},
      actions: {},
      gates: {},
      transitions: {},
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

function makeOpts(
  cwd: string,
  overrides: Partial<GlobalOptions> = {},
): Parameters<typeof runApply>[0] {
  return {
    cwd,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "apply",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
    ...overrides,
  };
}

async function makeCwd(secret: object, flows: Record<string, object> = {}): Promise<string> {
  const cwd = join(tmpdir(), `zitadel-apply-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(secret));
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({ framework: "next", resources: {} }),
  );
  for (const [name, contents] of Object.entries(flows)) {
    await writeFile(join(cwd, ".zitadel/flows", name), JSON.stringify(contents));
  }
  return cwd;
}

describe("runApply pre-flight checks", () => {
  it("blocks when a flow definition is invalid", async () => {
    const cwd = await makeCwd(SECRET, {
      "bad.json": { version: 99, kind: "wrong" },
    });
    try {
      await expect(runApply(makeOpts(cwd))).rejects.toMatchObject({
        code: "E_VALIDATION",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks when a referenced env var is missing", async () => {
    const flowWithEnvRef = {
      ...VALID_FLOW,
      steps: [
        {
          ...VALID_FLOW.steps[0],
          gates: { captcha: { type: "captcha", config: { client_secret_env: "MY_SECRET" } } },
        },
      ],
    };
    const cwd = await makeCwd(SECRET, { "default.json": flowWithEnvRef });
    try {
      await expect(runApply(makeOpts(cwd))).rejects.toThrow(
        "Missing environment variables",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("passes when all referenced env vars are present", async () => {
    const flowWithEnvRef = {
      ...VALID_FLOW,
      steps: [
        {
          ...VALID_FLOW.steps[0],
          gates: { captcha: { type: "captcha", config: { client_secret_env: "MY_SECRET" } } },
        },
      ],
    };
    const cwd = await makeCwd(SECRET, { "default.json": flowWithEnvRef });
    try {
      await expect(
        runApply(makeOpts(cwd, { env: { MY_SECRET: "hunter2" } })),
      ).resolves.not.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
