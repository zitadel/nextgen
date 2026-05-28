import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runStatus } from "../../../src/commands/status";
import type { CliIO, GlobalOptions } from "../../../src/io/output";

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
};

let captured = "";

function makeIO(env: Record<string, string> = {}): CliIO {
  captured = "";
  return {
    stdout: {
      write: (chunk: string): boolean => {
        captured += chunk;
        return true;
      },
    } as never,
    stderr: { write: (): boolean => true } as never,
    env,
    isTTY: false,
  };
}

function makeOpts(cwd: string, overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd,
    json: true,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "status",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    ...overrides,
  };
}

function parseEnvelope(): Record<string, unknown> {
  return JSON.parse(captured) as Record<string, unknown>;
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
  it("emits an ok envelope for a healthy project with config and secret", async () => {
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

    const io = makeIO();
    await runStatus(io, makeOpts(cwd, { source: "https://api.zitadel.cloud" }));

    const envelope = parseEnvelope();
    expect(envelope.status).toBe("ok");
    expect(envelope.command).toBe("status");
    const data = envelope.data as {
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

    const io = makeIO();
    await runStatus(io, makeOpts(cwd));

    const envelope = parseEnvelope();
    expect(envelope.status).toBe("skipped");
    expect(envelope.reason).toBe("orphaned-config");
    const data = envelope.data as { project_id?: string; lifecycle: string };
    expect(data.project_id).toBe("orphan");
    expect(data.lifecycle).toBe("orphaned-config");
    expect(envelope.next_commands).toContain("zitadel setup --force");
  });

  it("throws E_VALIDATION when zitadel.json is missing entirely", async () => {
    const cwd = await makeProject();
    const io = makeIO();
    await expect(runStatus(io, makeOpts(cwd))).rejects.toMatchObject({
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

    const io = makeIO();
    await runStatus(io, makeOpts(cwd));

    const envelope = parseEnvelope();
    expect(envelope.status).toBe("ok");
    const data = envelope.data as { project: { project_id: string; issuer?: string } };
    expect(data.project.project_id).toBe("proj-001");
    expect(data.project.issuer).toBeUndefined();
  });
});
