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
};

const tempDirs: string[] = [];

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-status-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  return cwd;
}

function status(cwd: string) {
  return runCliForTest([
    "status",
    "--cwd",
    cwd,
    "--json",
    "--server",
    "https://api.zitadel.cloud",
  ]);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("status command", () => {
  it("returns an ok envelope for a healthy project with config and secret", async () => {
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

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        server: { lifecycle: string };
        project: { lifecycle: string; project_id: string; issuer?: string };
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.server.lifecycle).toBe("missing");
    expect(json.data.project.lifecycle).toBe("configured");
    expect(json.data.project.project_id).toBe("proj-001");
    expect(json.data.project.issuer).toBe("http://localhost:3000");
    expect(json.data.next_commands).toContain("zitadel doctor");
  });

  it("reports orphaned-config when zitadel.json exists but secret is missing", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ project: "orphan", server: "https://api.zitadel.cloud" }),
    );

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        project: { project_id?: string; lifecycle: string };
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.next_commands).toContain("zitadel setup --force");
    expect(json.data.project.project_id).toBe("orphan");
    expect(json.data.project.lifecycle).toBe("orphaned-config");
  });

  it("reports not-configured when zitadel.json is missing entirely", async () => {
    const cwd = await makeProject();

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        server: { lifecycle: string };
        project: { lifecycle: string };
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.server.lifecycle).toBe("missing");
    expect(json.data.project.lifecycle).toBe("not-configured");
    expect(json.data.next_commands).toContain("zitadel start");
    expect(json.data.next_commands).toContain("zitadel setup --framework next --server local");
  });

  it("falls back to the secret project_id when config.project is absent", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ server: "https://api.zitadel.cloud" }),
    );
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { project: { lifecycle: string; project_id: string; issuer?: string } };
    };
    expect(json.status).toBe("ok");
    expect(json.data.project.lifecycle).toBe("configured");
    expect(json.data.project.project_id).toBe("proj-001");
    expect(json.data.project.issuer).toBeUndefined();
  });
});
