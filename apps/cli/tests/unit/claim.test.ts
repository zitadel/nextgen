import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runClaim } from "../../src/commands/claim";
import type { CliIO, GlobalOptions } from "../../src/io/output";

const platformMocks = vi.hoisted(() => ({
  createPlatformClient: vi.fn(),
}));

vi.mock("../../src/platform", () => ({
  createPlatformClient: platformMocks.createPlatformClient,
}));

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_old",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
  schema_version: 2,
};

function makeOpts(cwd: string, overrides: Partial<GlobalOptions> = {}): Parameters<typeof runClaim>[1] {
  return {
    cwd,
    json: true,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "claim",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    ...overrides,
  };
}

type TestIO = CliIO & { stdout: { write: ReturnType<typeof vi.fn> } };

function makeIO(): TestIO {
  const stdout = { write: vi.fn() };
  return {
    stdout,
    stderr: { write: vi.fn() } as never,
    env: {},
    isTTY: false,
  } as TestIO;
}

async function makeCwd(): Promise<string> {
  const cwd = join(tmpdir(), `zitadel-claim-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET, null, 2));
  return cwd;
}

describe("claim", () => {
  it("does not call the API or rewrite .zitadel/secret during dry-run", async () => {
    const cwd = await makeCwd();
    const io = makeIO();
    try {
      await runClaim(io, makeOpts(cwd, { dryRun: true, challengeId: "claim_001" }));

      expect(platformMocks.createPlatformClient).not.toHaveBeenCalled();
      await expect(readFile(join(cwd, ".zitadel/secret"), "utf8")).resolves.toBe(
        JSON.stringify(SECRET, null, 2),
      );
      const output = JSON.parse(String(io.stdout.write.mock.calls[0][0]));
      expect(output.status).toBe("skipped");
      expect(output.data.action).toBe("poll_claim_status");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      platformMocks.createPlatformClient.mockReset();
    }
  });
});
