import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { http, HttpResponse } from "msw";
import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { LocalRuntime, type RuntimeMetadata } from "@/lib/server";
import { it } from "@tests/fixtures";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { asOneLine, asTerminal } from "@tests/fixtures/terminal";
import { stripAnsi } from "@tests/helpers/run-cli";

// The platform is unreachable unless a test says otherwise — a network error,
// not an HTTP status — so the user-presence probe reads as "unknown" and
// status keeps its lifecycle-only output.
it.beforeEach(({ server }) => {
  server.use(http.post("*/users/query", () => HttpResponse.error()));
});

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  primary_origins: [],
  preview_origins: [],
  // Recent, so the claim window reads as open; the closed-window test writes
  // its own stale timestamp.
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

/**
 * Makes the directory hold the folder a project keeps its files in.
 *
 * @param cwd - The directory.
 * @returns Once the folder is there.
 */
async function makeProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
}

function status(cwd: string) {
  return runCliForTest(["status", "--cwd", cwd, "--json", "--server", "https://api.zitadel.cloud"]);
}

/**
 * Makes the directory a project that is configured, with a secret.
 *
 * @param cwd - The directory.
 * @returns Once the project's files are written.
 */
async function configuredProject(cwd: string): Promise<void> {
  await makeProject(cwd);
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify({
      project: "proj-001",
      server: "https://api.zitadel.cloud",
    }),
  );
  await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
}

describe("status command", () => {
  it("returns an ok envelope for a healthy project with config and secret", async ({
    dir: cwd,
  }) => {
    await configuredProject(cwd);

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
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`doctor --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  it("keeps the command overview out of what a script reads, in the text and the envelope alike", async ({
    dir: cwd,
  }) => {
    await configuredProject(cwd);

    const text = await runCliForTest([
      "status",
      "--cwd",
      cwd,
      "--server",
      "https://api.zitadel.cloud",
    ]);
    const json = await status(cwd);

    expect(asOneLine(text.stdout)).not.toContain("Explore all commands");
    expect(json.stdout).not.toContain("Explore all commands");
  });

  it("reports a project with no owning team as temporary and points at claim", async ({
    dir: cwd,
  }) => {
    await configuredProject(cwd);

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: {
        project: { claim?: { kind: string } };
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(json.data.project.claim).toMatchObject({ kind: "detached", claimable: true });
    expect(json.data.next_actions.join("\n")).toContain("temporary and its data may be lost");
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  // Once the locally recorded creation time says the 14-day window has
  // passed, the nudge flips to reconciliation wording. The claim command
  // stays suggested: the local record can be stale (claimed from another
  // machine reads detached) and the server resolves the grant before the
  // window, so running claim is the safe authoritative check.
  it("switches to reconciliation guidance once the claim window has closed", async ({
    dir: cwd,
  }) => {
    await configuredProject(cwd);
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({ ...SECRET, created_at: "2026-01-01T00:00:00.000Z" }),
    );

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: {
        project: { claim?: { kind: string; claimable?: boolean } };
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(json.data.project.claim).toMatchObject({ kind: "detached", claimable: false });
    const actions = json.data.next_actions.join("\n");
    expect(actions).toContain("claim window has closed");
    expect(actions).toContain("no longer be claimed");
    expect(actions).not.toContain("its data may be lost");
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  it("reports the owning team once claimed, and stops nudging", async ({ dir: cwd }) => {
    await configuredProject(cwd);
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
    expect(json.data.next_actions.join("\n")).not.toContain("its data may be lost");
    expect(json.data.next_commands).not.toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  // The project lives wherever `zitadel.json` says, not wherever this
  // invocation is pointed: `--server local` retargets the health probe only.
  it("omits claim state for a local project, whatever --server says", async ({ dir: cwd }) => {
    await makeProject(cwd);
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "http://localhost:8080",
      }),
    );
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));

    const res = await status(cwd);

    const json = parseJson(res.stdout) as {
      data: { project: { claim?: unknown }; next_commands: string[] };
    };
    expect(json.data.project.claim).toBeUndefined();
    expect(json.data.next_commands).not.toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  it("reports orphaned-config when zitadel.json exists but secret is missing", async ({
    dir: cwd,
  }) => {
    await makeProject(cwd);
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
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`setup --force --cwd ${cwd}`),
    );
    expect(json.data.project.project_id).toBe("orphan");
    expect(json.data.project.lifecycle).toBe("orphaned-config");
  });

  it("reports the resolved environment's project when --env names one without a local secret", async ({
    dir: cwd,
  }) => {
    await makeProject(cwd);
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ project: "proj-local", server: "https://api.zitadel.cloud" }),
    );
    await writeFile(
      join(cwd, ".env.production.local"),
      "ZITADEL_URL=https://api.zitadel.cloud\nZITADEL_PROJECT_ID=proj-prod\nZITADEL_PROJECT_SECRET=sk_prod\n",
    );

    const res = await runCliForTest(["status", "--cwd", cwd, "--json", "--env", "production"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { project: { lifecycle: string; project_id?: string } };
    };
    // Without the reorder this reads "orphaned-config" because `.zitadel/secret`
    // is absent; the resolved environment names proj-prod, so status reports
    // that project as configured and ignores config.project.
    expect(json.data.project.lifecycle).toBe("configured");
    expect(json.data.project.project_id).toBe("proj-prod");
  });

  it("reports a named environment that binds no project as not configured", async ({
    dir: cwd,
  }) => {
    await makeProject(cwd);

    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ project: "proj-local", server: "https://api.zitadel.cloud" }),
    );

    const res = await runCliForTest(["status", "--cwd", cwd, "--json", "--env", "production"]);

    const json = parseJson(res.stdout) as {
      data: { project: { lifecycle: string; environment?: string }; next_commands: string[] };
    };
    expect(json.data.project).toMatchObject({
      lifecycle: "not-configured",
      environment: "production",
    });
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`env add production --cwd ${cwd}`),
    );
  });

  it("reports not-configured when zitadel.json is missing entirely", async ({ dir: cwd }) => {
    await makeProject(cwd);

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
    expect(json.data.next_commands).toContain(expectedPublicCliCommand(`start --cwd ${cwd}`));
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`setup --server local --cwd ${cwd}`),
    );
  });

  it("normalizes relative --cwd before reading runtime metadata", async ({
    dir: cwd,
    other: binDir,
  }) => {
    await makeProject(cwd);
    await LocalRuntime.write(cwd, runtimeFor(cwd, "http://localhost:9"));

    // The docker-backend fixture makes status spawn `docker inspect`; a fake
    // on PATH keeps the test hermetic — with a wedged Docker daemon the real
    // CLI blocks on the socket forever instead of failing fast.
    await writeFile(join(binDir, "docker"), "#!/usr/bin/env node\nprocess.exit(1);\n");
    await chmod(join(binDir, "docker"), 0o755);

    const res = await runCliForTest(
      [
        "status",
        "--cwd",
        relative(process.cwd(), cwd),
        "--json",
        "--server",
        "https://api.zitadel.cloud",
      ],
      { PATH: `${binDir}:${process.env.PATH ?? ""}` },
    );

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { server: { runtime: { configured: boolean; data_dir?: string } } };
    };
    expect(json.status).toBe("ok");
    expect(json.data.server.runtime.configured).toBe(true);
    expect(json.data.server.runtime.data_dir).toBe(LocalRuntime.paths(cwd).dataDir);
  });

  it("falls back to the secret project_id when config.project is absent", async ({ dir: cwd }) => {
    await makeProject(cwd);
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

  it("stages verify-login guidance while the project has no users", async ({
    server,
    dir: cwd,
  }) => {
    await configuredProject(cwd);
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
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`deploy --dry-run --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
    expect(json.data.next_commands).not.toContain(
      expectedPublicCliCommand(
        `deploy --message '<what changed>' --server https://api.zitadel.cloud --cwd ${cwd}`,
      ),
    );
  });

  it("switches to customize/publish guidance once users exist", async ({ server, dir: cwd }) => {
    await configuredProject(cwd);
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
      `See your changes before they go live: ${expectedPublicCliCommand(`deploy --dry-run --server https://api.zitadel.cloud --cwd ${cwd}`)} to ` +
        `preview, then ${expectedPublicCliCommand(`deploy --message '<what changed>' --server https://api.zitadel.cloud --cwd ${cwd}`)} to publish.`,
    );
    expect(actions).not.toContain("register a user");
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(
        `deploy --message '<what changed>' --server https://api.zitadel.cloud --cwd ${cwd}`,
      ),
    );
  });

  describe("with tests add", () => {
    /** Makes the directory a configured project whose zitadel.json records `framework`. */
    async function aProjectOf(cwd: string, framework: string): Promise<void> {
      await configuredProject(cwd);
      await writeFile(
        join(cwd, "zitadel.json"),
        JSON.stringify({
          project: "proj-001",
          server: "https://api.zitadel.cloud",
          framework: { id: framework },
        }),
      );
    }

    /** Answers the user-presence probe with `count` users. */
    function withUsers(server: SetupServer, count: number): void {
      server.use(
        http.post("*/users/query", () => {
          return HttpResponse.json({
            users: Array.from({ length: count }, (_, at) => {
              return { id: `usr_${at}` };
            }),
          });
        }),
      );
    }

    /** The run's envelope, as far as these tests read it. */
    type Next = { data: { next_actions: string[]; next_commands: string[] } };

    it("offers it once a sign-in has worked in a Next.js app", async ({ server, dir: cwd }) => {
      await aProjectOf(cwd, "next");
      withUsers(server, 1);

      const res = await status(cwd);

      expect((parseJson(res.stdout) as Next).data.next_actions).toContain(
        `Keep the sign-in working with an end-to-end test whenever you want one: ${expectedPublicCliCommand(`tests add --cwd ${cwd}`)} adds Playwright tests on @zitadel/testing and installs them as dev dependencies.`,
      );
    });

    it("never names it in next_commands, where an agent would run it unasked", async ({
      server,
      dir: cwd,
    }) => {
      await aProjectOf(cwd, "next");
      withUsers(server, 1);

      const res = await status(cwd);

      expect((parseJson(res.stdout) as Next).data.next_commands.join("\n")).not.toContain(
        "tests add",
      );
    });

    it.for<[string, string, number]>([
      ["before the first sign-in", "next", 0],
      ["for a framework it writes no suite for", "nuxt", 1],
    ])("does not offer it %s", async ([_, framework, users], { server, dir: cwd }) => {
      await aProjectOf(cwd, framework);
      withUsers(server, users);

      const res = await status(cwd);

      expect((parseJson(res.stdout) as Next).data.next_actions.join("\n")).not.toContain(
        "tests add",
      );
    });

    it("answers with its next steps in the cases it does not offer it", async ({
      server,
      dir: cwd,
    }) => {
      await aProjectOf(cwd, "nuxt");
      withUsers(server, 1);

      const res = await status(cwd);

      expect((parseJson(res.stdout) as Next).data.next_actions.join("\n")).toContain(
        "Customize what you ask for",
      );
    });
  });

  it("keeps lifecycle-only output when the platform is unreachable", async ({ dir: cwd }) => {
    await configuredProject(cwd);

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
    expect(actions).toContain("temporary and its data may be lost");
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(
        `deploy --message '<what changed>' --server https://api.zitadel.cloud --cwd ${cwd}`,
      ),
    );
  });

  it("says in text that no local server was started in the directory", async ({ dir: cwd }) => {
    await configuredProject(cwd);

    const res = await asTerminal(() =>
      runCliForTest(["status", "--cwd", cwd, "--server", "https://api.zitadel.cloud"]),
    );

    expect(stripAnsi(res.stdout)).toContain("No local server was started in this directory.");
  });

  it("says the same in text read by a pipe", async ({ dir: cwd }) => {
    await configuredProject(cwd);

    const res = await runCliForTest([
      "status",
      "--cwd",
      cwd,
      "--server",
      "https://api.zitadel.cloud",
    ]);

    expect(stripAnsi(res.stdout)).toContain("No local server was started in this directory.");
  });

  it("says in text where a stopped local server last ran", async ({ dir: cwd, other: binDir }) => {
    await configuredProject(cwd);
    await LocalRuntime.write(cwd, runtimeFor(cwd, "http://localhost:9"));
    await writeFile(join(binDir, "docker"), "#!/usr/bin/env node\nprocess.exit(1);\n");
    await chmod(join(binDir, "docker"), 0o755);

    const res = await runCliForTest(
      ["status", "--cwd", cwd, "--server", "https://api.zitadel.cloud"],
      { PATH: `${binDir}:${process.env.PATH ?? ""}` },
    );

    expect(stripAnsi(res.stdout)).toContain(
      "The local server is stopped, and last ran at http://localhost:9 (docker).",
    );
  });

  it("says in text when Docker could not be asked about the local server", async ({
    dir: cwd,
    other: noDocker,
  }) => {
    await configuredProject(cwd);
    await LocalRuntime.write(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest(
      ["status", "--cwd", cwd, "--server", "https://api.zitadel.cloud"],
      { PATH: noDocker },
    );

    expect(stripAnsi(res.stdout)).toContain("and Docker could not be asked about it");
  });

  // It resolves the project without opening a connection — the user-presence
  // probe connects quietly and swallows every failure — so nothing else can
  // record where it ran.
  it("names the project it reported on, not only the server", async ({ dir: cwd }) => {
    await configuredProject(cwd);

    const res = await asTerminal(() =>
      runCliForTest(["status", "--cwd", cwd, "--server", "https://api.zitadel.cloud"]),
    );

    expect(stripAnsi(res.stdout)).toContain("project proj-001 on api.zitadel.cloud");
    expect(stripAnsi(res.stdout)).not.toContain("Using project proj-001");
  });
});

function runtimeFor(cwd: string, serverUrl: string): RuntimeMetadata {
  return {
    schema_version: 1,
    backend: "docker",
    container_name: LocalRuntime.containerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: LocalRuntime.paths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
}
