import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type CommandCall = { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv };

type DeploySmokeModule = {
  runDeploySmoke: (options: {
    repoRoot?: string;
    target?: string;
    image?: string;
    workDir?: string;
    port?: number;
    projectName?: string;
    diagnosticsDir?: string;
    keep?: boolean;
    timeoutMs?: number;
    run?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<void>;
    runCapture?: (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<{ stdout: string }>;
    fetchImpl?: (url: string) => Promise<Response>;
    log?: (message: string) => void;
  }) => Promise<{ target: string; image: string; baseUrl: string; projectName: string }>;
  probeDeployment: (options: {
    baseUrl: string;
    fetchImpl: (url: string) => Promise<Response>;
    log?: (message: string) => void;
    timeoutMs?: number;
    delayMs?: number;
  }) => Promise<void>;
  composeOverride: (repoRoot: string) => string;
  parseArgs: (args: string[]) => { target: string; image: string; keep: boolean };
};

const tempDirs: string[] = [];

async function loadModule(): Promise<DeploySmokeModule> {
  return (await import(
    new URL("../../../../../scripts/deploy-smoke.mjs", import.meta.url).href
  )) as DeploySmokeModule;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function healthyFetch(overrides: Record<string, () => Response> = {}) {
  return async (url: string): Promise<Response> => {
    const path = new URL(url).pathname;
    if (overrides[path]) {
      return overrides[path]();
    }
    if (path === "/healthz" || path === "/livez" || path === "/readyz") {
      return new Response("ok", { status: 200 });
    }
    if (path === "/sessions/me") {
      return jsonResponse(401, { error: { code: "unauthenticated" } });
    }
    return new Response("not found", { status: 404 });
  };
}

describe("deploy smoke", () => {
  it("boots the copied compose surface, probes it, and tears down", async () => {
    const { runDeploySmoke } = await loadModule();
    const workDir = await tempDir("zitadel-smoke-work-");

    const calls: CommandCall[] = [];
    const result = await runDeploySmoke({
      image: "ghcr.io/zitadel/nextgen:test-smoke",
      workDir,
      port: 18080,
      projectName: "nextgen-smoke-test",
      run: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd, env: options.env });
      },
      runCapture: async (command, args) => {
        if (args.includes("--filter")) {
          return { stdout: "nextgen\npostgres\n" };
        }
        throw new Error(`unexpected capture ${command} ${args.join(" ")}`);
      },
      fetchImpl: healthyFetch(),
      log: () => {},
    });

    expect(result.baseUrl).toBe("http://127.0.0.1:18080");

    const up = calls.find((call) => call.args.includes("up"));
    expect(up?.command).toBe("docker");
    expect(up?.args).toEqual(
      expect.arrayContaining(["compose", "-p", "nextgen-smoke-test", "up", "-d", "--wait"]),
    );
    expect(up?.args).toEqual(expect.arrayContaining(["-f", "smoke.override.yaml"]));
    expect(up?.cwd).toBe(workDir);
    expect(up?.env?.NEXTGEN_IMAGE).toBe("ghcr.io/zitadel/nextgen:test-smoke");
    expect(up?.env?.NEXTGEN_PORT).toBe("18080");

    const down = calls.find((call) => call.args.includes("down"));
    expect(down?.args).toEqual(expect.arrayContaining(["down", "-v", "--remove-orphans"]));

    // The compose file must be the documented one, copied verbatim, and the
    // required .env must exist next to it.
    const copied = await readFile(join(workDir, "docker-compose.yaml"), "utf8");
    expect(copied).toContain("NEXTGEN_IMAGE");
    await expect(readFile(join(workDir, ".env"), "utf8")).resolves.toContain("deploy-smoke");
    const override = await readFile(join(workDir, "smoke.override.yaml"), "utf8");
    expect(override).toContain("--user-file");
    expect(override).toContain("/bootstrap/demo-admin.json");
  });

  it("collects diagnostics and still tears down when probes fail", async () => {
    const { runDeploySmoke } = await loadModule();
    const workDir = await tempDir("zitadel-smoke-fail-");
    const diagnosticsDir = join(await tempDir("zitadel-smoke-diag-"), "diagnostics");

    const calls: CommandCall[] = [];
    await expect(
      runDeploySmoke({
        image: "ghcr.io/zitadel/nextgen:test-smoke",
        workDir,
        port: 18081,
        diagnosticsDir,
        timeoutMs: 10,
        run: async (command, args) => {
          calls.push({ command, args });
        },
        runCapture: async (command, args) => {
          if (args.includes("logs")) {
            return { stdout: "nextgen exited with code 1" };
          }
          return { stdout: "" };
        },
        fetchImpl: async () => new Response("boom", { status: 500 }),
        log: () => {},
      }),
    ).rejects.toThrow("timed out waiting for");

    await expect(readFile(join(diagnosticsDir, "compose-logs.txt"), "utf8")).resolves.toContain(
      "exited with code 1",
    );
    expect(calls.some((call) => call.args.includes("down"))).toBe(true);
  });

  it("fails when the API surface does not answer with a structured 401", async () => {
    const { probeDeployment } = await loadModule();

    await expect(
      probeDeployment({
        baseUrl: "http://127.0.0.1:18082",
        fetchImpl: healthyFetch({
          "/sessions/me": () => new Response("plain 404", { status: 404 }),
        }),
        log: () => {},
      }),
    ).rejects.toThrow("should be rejected with 401/403");

    await expect(
      probeDeployment({
        baseUrl: "http://127.0.0.1:18082",
        fetchImpl: healthyFetch({
          "/sessions/me": () => new Response("<html>login</html>", { status: 401 }),
        }),
        log: () => {},
      }),
    ).rejects.toThrow("JSON error body");
  });

  it("fails when a service is no longer running after probes", async () => {
    const { runDeploySmoke } = await loadModule();
    const workDir = await tempDir("zitadel-smoke-crash-");

    await expect(
      runDeploySmoke({
        image: "ghcr.io/zitadel/nextgen:test-smoke",
        workDir,
        port: 18083,
        run: async () => {},
        runCapture: async (command, args) => {
          if (args.includes("--filter")) {
            return { stdout: "postgres\n" };
          }
          return { stdout: "" };
        },
        fetchImpl: healthyFetch(),
        log: () => {},
      }),
    ).rejects.toThrow("services not running after probes: nextgen");
  });

  it("rejects unknown targets with the available list", async () => {
    const { runDeploySmoke, parseArgs } = await loadModule();

    await expect(runDeploySmoke({ target: "helm", image: "x" })).rejects.toThrow(
      "unknown deploy smoke target: helm; available: compose",
    );
    expect(parseArgs(["--target", "compose", "--image", "x", "--keep"])).toEqual({
      target: "compose",
      image: "x",
      keep: true,
      help: false,
    });
  });
});
