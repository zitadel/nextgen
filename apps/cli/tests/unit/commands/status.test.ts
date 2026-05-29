import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runStatus } from "../../../src/commands/status";
import type { GlobalOptions } from "../../../src/lib/oclif";

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
};

function makeOpts(cwd: string, overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "status",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
    ...overrides,
  };
}

const tempDirs: string[] = [];

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-status-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
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

describe("runStatus", () => {
  it("returns an ok result for a healthy project with config and secret", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "https://api.zitadel.cloud",
        environments: { development: { issuer: "http://localhost:3000" } },
      }),
    );
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));

    const result = await runStatus(makeOpts(cwd, { source: "https://api.zitadel.cloud" }));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const data = result.data as {
      project: { project_id: string; issuer?: string };
      next_commands: string[];
    };
    expect(data.project.project_id).toBe("proj-001");
    expect(data.project.issuer).toBe("http://localhost:3000");
    expect(data.next_commands).toContain("zitadel doctor");
  });

  it("reports orphaned-config when zitadel.json exists but secret is missing", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ project: "orphan", server: "https://api.zitadel.cloud" }),
    );

    const result = await runStatus(makeOpts(cwd));

    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") {
      throw new Error("expected skipped");
    }
    expect(result.reason).toBe("orphaned-config");
    expect(result.nextCommands).toContain("zitadel setup --force");
    const data = result.data as { project_id?: string; lifecycle: string };
    expect(data.project_id).toBe("orphan");
    expect(data.lifecycle).toBe("orphaned-config");
  });

  it("throws E_VALIDATION when zitadel.json is missing entirely", async () => {
    const cwd = await makeProject();
    await expect(runStatus(makeOpts(cwd))).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("falls back to the secret project_id when config.project is absent", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ server: "https://api.zitadel.cloud" }),
    );
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));

    const result = await runStatus(makeOpts(cwd));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const data = result.data as { project: { project_id: string; issuer?: string } };
    expect(data.project.project_id).toBe("proj-001");
    expect(data.project.issuer).toBeUndefined();
  });
});
