import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { runApply } from "../../src/commands/apply";
import type { CliIO, GlobalOptions } from "../../src/io/output";

vi.mock("../../src/sync/loop", () => ({
  runSyncLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/platform/index", () => ({
  createPlatformClient: vi.fn().mockReturnValue({}),
}));

const VALID_FLOW = {
  version: 1,
  kind: "flow-definition",
  slug: "default",
  name: "Default",
  purposes: ["login"],
  template_name: "default",
  initial_steps: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      type: "identifier",
      texts: {},
      fields: {},
      actions: {},
      gates: {},
      transitions: {},
    },
  ],
};

const UNCLAIMED_SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
  schema_version: 2,
};

const CLAIMED_SECRET = {
  ...UNCLAIMED_SECRET,
  claimed_at: "2026-02-01T00:00:00.000Z",
  team_id: "team-001",
};

function makeOpts(cwd: string, overrides: Partial<GlobalOptions> = {}): Parameters<typeof runApply>[1] {
  return {
    cwd,
    json: false,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "apply",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    ...overrides,
  };
}

function makeIO(env: Record<string, string> = {}): CliIO {
  return {
    stdout: { write: vi.fn() } as never,
    stderr: { write: vi.fn() } as never,
    env,
    isTTY: false,
  };
}

async function makeCwd(secret: object, flows: Record<string, object> = {}): Promise<string> {
  const cwd = join(tmpdir(), `zitadel-apply-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify(secret),
  );
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({ framework: "next", resources: {} }),
  );
  for (const [name, contents] of Object.entries(flows)) {
    await writeFile(join(cwd, ".zitadel/flows", name), JSON.stringify(contents));
  }
  return cwd;
}

describe("apply pre-flight checks", () => {
  it("blocks production apply when project is unclaimed", async () => {
    const cwd = await makeCwd(UNCLAIMED_SECRET);
    try {
      await expect(
        runApply(makeIO(), { ...makeOpts(cwd), environment: "production" }),
      ).rejects.toThrow("E_CLAIM_REQUIRED");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows production apply when project is claimed", async () => {
    const cwd = await makeCwd(CLAIMED_SECRET, { "default.json": VALID_FLOW });
    try {
      await expect(
        runApply(makeIO(), { ...makeOpts(cwd), environment: "production" }),
      ).resolves.not.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks when a flow definition is invalid", async () => {
    const cwd = await makeCwd(UNCLAIMED_SECRET, {
      "bad.json": { version: 99, kind: "wrong" },
    });
    try {
      await expect(runApply(makeIO(), makeOpts(cwd))).rejects.toThrow("E_VALIDATION");
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
          gates: { client_secret_env: "MY_SECRET" },
        },
      ],
    };
    const cwd = await makeCwd(UNCLAIMED_SECRET, { "default.json": flowWithEnvRef });
    try {
      await expect(
        runApply(makeIO({}), makeOpts(cwd)),
      ).rejects.toThrow("Missing environment variables");
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
          gates: { client_secret_env: "MY_SECRET" },
        },
      ],
    };
    const cwd = await makeCwd(UNCLAIMED_SECRET, { "default.json": flowWithEnvRef });
    try {
      await expect(
        runApply(makeIO({ MY_SECRET: "hunter2" }), makeOpts(cwd)),
      ).resolves.not.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
