import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../helpers/run-cli";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function project(packageJson?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-run-"));
  dirs.push(dir);
  if (packageJson) {
    await writeFile(join(dir, "package.json"), JSON.stringify(packageJson));
  }
  return dir;
}

type RunPlan = {
  status: string;
  data: {
    app: { command?: string; port?: number; skipped?: string };
    apply_on_start: boolean;
    keys: Record<string, string>;
    next_commands: string[];
    runtime: { backend: string; container_name?: string; image?: string; port: number };
  };
};

describe("run", () => {
  it("--dry-run reports what the session would start", async () => {
    const cwd = await project({ scripts: { dev: "next dev --port 3100" } });

    const result = await runCliForTest(["run", "--cwd", cwd, "--json", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as RunPlan;
    expect(envelope.status).toBe("ok");
    expect(envelope.data.runtime).toEqual({ backend: "binary", port: 8080 });
    expect(envelope.data.app).toEqual({ command: "npm run dev", port: 3100 });
    expect(envelope.data.apply_on_start).toBe(true);
    expect(Object.keys(envelope.data.keys)).toEqual(["r", "R", "q", "h"]);
    expect(envelope.data.next_commands).toEqual([expectedPublicCliCommand("run")]);
  });

  it("--dry-run names the container it would run under the docker backend", async () => {
    const cwd = await project({ scripts: { dev: "next dev" } });

    const result = await runCliForTest([
      "run",
      "--cwd",
      cwd,
      "--json",
      "--dry-run",
      "--runtime",
      "docker",
      "--image",
      "ghcr.io/zitadel/nextgen:test",
    ]);

    const envelope = parseJson(result.stdout) as RunPlan;
    expect(envelope.data.runtime).toMatchObject({
      backend: "docker",
      image: "ghcr.io/zitadel/nextgen:test",
    });
    expect(envelope.data.runtime.container_name).toMatch(/^zitadel-server-[\da-f]{12}$/);
  });

  it("--dry-run says why no app dev server would start", async () => {
    const cwd = await project({ scripts: { build: "next build" } });

    const result = await runCliForTest(["run", "--cwd", cwd, "--json", "--dry-run"]);

    const envelope = parseJson(result.stdout) as RunPlan;
    expect(envelope.data.app.skipped).toContain('"dev" script');
  });

  it("--no-app records that the app was turned off, not missing", async () => {
    const cwd = await project({ scripts: { dev: "next dev" } });

    const result = await runCliForTest(["run", "--cwd", cwd, "--json", "--dry-run", "--no-app"]);

    const envelope = parseJson(result.stdout) as RunPlan;
    expect(envelope.data.app).toEqual({ skipped: "--no-app" });
  });

  it("--no-apply is reported in the plan", async () => {
    const cwd = await project({ scripts: { dev: "next dev" } });

    const result = await runCliForTest(["run", "--cwd", cwd, "--json", "--dry-run", "--no-apply"]);

    expect((parseJson(result.stdout) as RunPlan).data.apply_on_start).toBe(false);
  });

  it("refuses to stream a session under --json", async () => {
    const cwd = await project({ scripts: { dev: "next dev" } });

    const result = await runCliForTest(["run", "--cwd", cwd, "--json"]);

    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as { code: string; status: string };
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_VALIDATION");
  });

  it("rejects a port no listener could bind", async () => {
    const cwd = await project({ scripts: { dev: "next dev" } });

    const result = await runCliForTest([
      "run",
      "--cwd",
      cwd,
      "--json",
      "--dry-run",
      "--port",
      "70000",
    ]);

    expect(result.exitCode).toBe(3);
    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });

  it("rejects an image without the docker runtime", async () => {
    const cwd = await project({ scripts: { dev: "next dev" } });

    const result = await runCliForTest([
      "run",
      "--cwd",
      cwd,
      "--json",
      "--dry-run",
      "--runtime",
      "binary",
      "--image",
      "ghcr.io/zitadel/nextgen:test",
    ]);

    expect(result.exitCode).toBe(3);
    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });
});
