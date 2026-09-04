import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  localContainerName,
  localRuntimePaths,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../src/lib/local-server/runtime";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../helpers/run-cli";

// The platform is unreachable unless a test says otherwise — a network error,
// not an HTTP status — so the user-presence probe reads as "unknown" and
// status keeps its lifecycle-only output.
const server = setupServer(http.post("*/users/query", () => HttpResponse.error()));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

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
  return runCliForTest(["status", "--cwd", cwd, "--json", "--server", "https://api.zitadel.cloud"]);
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

async function configuredProject(server = "https://api.zitadel.cloud"): Promise<string> {
  const cwd = await makeProject();
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify({
      project: "proj-001",
      server,
      environments: { development: { issuer: "http://localhost:3000" } },
    }),
  );
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
  return cwd;
}

describe("status command", () => {
  it("returns an ok envelope for a healthy project with config and secret", async () => {
    const cwd = await configuredProject();

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
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("doctor"));
  });

  it("reports a project with no owning team as temporary and points at claim", async () => {
    const cwd = await configuredProject();

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: {
        project: { claim?: { kind: string } };
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(json.data.project.claim).toEqual({ kind: "detached" });
    expect(json.data.next_actions.join("\n")).toContain("temporary until you attach it to a team");
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("claim"));
  });

  it("reports the owning team once claimed, and stops nudging", async () => {
    const cwd = await configuredProject();
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({ ...SECRET, claimed_at: "2026-01-02T00:00:00.000Z", team_id: "team-001" }),
    );

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: {
        project: { claim?: { kind: string; team_id?: string; claimed_at?: string } };
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(json.data.project.claim).toEqual({
      kind: "attached",
      team_id: "team-001",
      claimed_at: "2026-01-02T00:00:00.000Z",
    });
    expect(json.data.next_actions.join("\n")).not.toContain("temporary until you attach");
    expect(json.data.next_commands).not.toContain(expectedPublicCliCommand("claim"));
  });

  // The local runtime carries the platform project and can take a claim. The
  // team `zitadel claim` recorded is a fact wherever the project lives; only
  // the nudge for a missing team is cloud-only.
  it("reports the owning team on a local server too", async () => {
    const cwd = await configuredProject("http://localhost:8080");
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({ ...SECRET, claimed_at: "2026-01-02T00:00:00.000Z", team_id: "team-001" }),
    );

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: { project: { claim?: { kind: string; team_id?: string } }; next_actions: string[] };
    };
    expect(json.data.project.claim).toEqual({
      kind: "attached",
      team_id: "team-001",
      claimed_at: "2026-01-02T00:00:00.000Z",
    });
    expect(json.data.next_actions.join("\n")).not.toContain("temporary until you attach");
  });

  // The project lives wherever `zitadel.json` says, not wherever this
  // invocation is pointed: `--server local` retargets the health probe only.
  it("omits claim state for a local project, whatever --server says", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "http://localhost:8080",
        environments: { development: { issuer: "http://localhost:3000" } },
      }),
    );
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: { project: { claim?: unknown }; next_commands: string[] };
    };
    expect(json.data.project.claim).toBeUndefined();
    expect(json.data.next_commands).not.toContain(expectedPublicCliCommand("claim"));
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
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("setup --force"));
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
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.server.lifecycle).toBe("missing");
    expect(json.data.project.lifecycle).toBe("not-configured");
    expect(json.data.next_actions.join("\n")).toContain("From your app directory");
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("start"));
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("setup --server local"));
  });

  it("normalizes relative --cwd before reading runtime metadata", async () => {
    const cwd = await makeProject();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    // The docker-backend fixture makes status spawn `docker inspect`; a fake
    // on PATH keeps the test hermetic — with a wedged Docker daemon the real
    // CLI blocks on the socket forever instead of failing fast.
    const binDir = await mkdtemp(join(tmpdir(), "zitadel-status-fake-docker-"));
    tempDirs.push(binDir);
    await writeFile(join(binDir, "docker"), "#!/usr/bin/env node\nprocess.exit(1);\n");
    await chmod(join(binDir, "docker"), 0o755);

    const res = await runCliForTest(
      ["status", "--cwd", relative(process.cwd(), cwd), "--json", "--server", "https://api.zitadel.cloud"],
      { PATH: `${binDir}:${process.env.PATH ?? ""}` },
    );

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { server: { runtime: { configured: boolean; data_dir?: string } } };
    };
    expect(json.status).toBe("ok");
    expect(json.data.server.runtime.configured).toBe(true);
    expect(json.data.server.runtime.data_dir).toBe(localRuntimePaths(cwd).dataDir);
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

  it("stages verify-login guidance while the project has no users", async () => {
    const cwd = await configuredProject();
    server.use(http.post("*/users/query", () => HttpResponse.json({ users: [] })));

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    const actions = json.data.next_actions.join("\n");
    expect(actions).toContain("open http://localhost:3000");
    expect(actions).toContain("register a user");
    expect(actions).not.toContain(".zitadel/schemas/");
    // next_commands is staged in lockstep: preview is fine, publishing
    // waits for the first proven login.
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("plan"));
    expect(json.data.next_commands).not.toContain(expectedPublicCliCommand("apply"));
  });

  it("switches to customize/publish guidance once users exist", async () => {
    const cwd = await configuredProject();
    server.use(http.post("*/users/query", () => HttpResponse.json({ users: [{ id: "usr_1" }] })));

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    const actions = json.data.next_actions.join("\n");
    expect(actions).toContain("Customize what you ask for and how people sign in");
    expect(actions).toContain(".zitadel/schemas/");
    expect(actions).toContain(
      `See your changes before they go live: ${expectedPublicCliCommand("plan")} to preview, ` +
        `then ${expectedPublicCliCommand("apply")} to publish.`,
    );
    expect(actions).not.toContain("register a user");
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("apply"));
  });

  it("keeps lifecycle-only output when the platform is unreachable", async () => {
    const cwd = await configuredProject();

    const res = await status(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { next_actions: string[]; next_commands: string[] };
    };
    // The journey guidance is staged on the user-presence probe, so an
    // unreachable platform withholds it. The claim nudge is not: it reads
    // `.zitadel/secret`, so it survives being offline — which is the point of
    // reading it locally rather than asking the platform.
    const actions = json.data.next_actions.join("\n");
    expect(actions).not.toContain("register a user");
    expect(actions).not.toContain("Customize what you ask for");
    expect(actions).toContain("temporary until you attach it to a team");
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("apply"));
  });
});

function runtimeFor(cwd: string, serverUrl: string): RuntimeMetadata {
  return {
    schema_version: 1,
    backend: "docker",
    container_name: localContainerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
}
