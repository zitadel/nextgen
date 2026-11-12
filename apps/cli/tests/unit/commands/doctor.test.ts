import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect } from "vitest";

import { it, type Serve } from "@tests/helpers/fixtures";

import { failureAdvice } from "@/commands/doctor";
import type { LocalServers } from "@/lib/local-server/processes";
import { projectMetaSchemas } from "@/lib/meta-schemas";
import { publicCliCommand } from "@/lib/public-cli";
import { MANAGED_MARKER } from "@/lib/paths";
import { advisoryForWarnings } from "@/commands/doctor/index";
import { nextPort } from "@tests/helpers/ports";
import { aSuggest, aSuggestWords } from "@tests/helpers/suggest";
import {
  aMachineRunning,
  cliVersion,
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
} from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";
import { stripAnsi } from "@tests/helpers/run-cli";

type Check = { name: string; status: "pass" | "warn" | "fail"; message: string; path?: string };

const tempDirs: string[] = [];

const VALID_USER_SCHEMA = {
  kind: "user-schema",
  objectType: "human-user",
  metaSchema: "https://zitadel.com/schemas/v1/user-schema.json",
  "x-auth-methods": { password: { enabled: true } },
  properties: { email: { type: "string" } },
};

async function doctor(cwd: string, extra: string[] = []) {
  const fake = await fakeDocker();
  const port = nextPort();
  return runCliForTest(
    [
      "doctor",
      "--cwd",
      cwd,
      "--json",
      "--port",
      String(port),
      "--server",
      "https://api.zitadel.cloud",
      ...extra,
    ],
    {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    },
  );
}

/** `doctor` as setup's next steps run it: no flag about the local runtime. */
async function doctorWithoutPort(cwd: string) {
  const fake = await fakeDocker();
  return runCliForTest(
    ["doctor", "--cwd", cwd, "--json", "--server", "https://api.zitadel.cloud"],
    { PATH: `${fake.binDir}:${process.env.PATH ?? ""}`, DOCKER_LOG: fake.logPath },
  );
}

/** The checks that look at the machine's local runtime rather than the project. */
const LOCAL_RUNTIME_CHECKS = new Set([
  "server-binary",
  "docker-cli",
  "image",
  "state-dir",
  "port",
  "runtime",
  "managed-runtime-processes",
]);

/** The names of the checks a doctor run reported, whether it passed or failed. */
function checkNamesOf(stdout: string): string[] {
  const json = parseJson(stdout) as {
    data?: { checks: Check[] };
    details?: { checks: Check[] };
  };
  return (json.data ?? json.details)?.checks.map((check) => check.name) ?? [];
}

/** Points the project's `zitadel.json` at another server, as setup records it. */
async function setProjectServer(cwd: string, server: string): Promise<void> {
  const path = join(cwd, "zitadel.json");
  const config = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...config, server }));
}

/** Records a healthy local server in `dir`, as `zitadel start` does, and returns its port. */
async function recordStartedServer(serve: Serve, dir: string): Promise<number> {
  const serverUrl = await startHealthServer(serve);
  const port = Number(new URL(serverUrl).port);
  await mkdir(join(dir, ".zitadel/local"), { recursive: true });
  await writeFile(
    join(dir, ".zitadel/local/runtime.json"),
    JSON.stringify({
      schema_version: 1,
      backend: "binary",
      port,
      server_url: serverUrl,
      data_dir: join(dir, ".zitadel/local/nextgen-data"),
      created_at: new Date().toISOString(),
      cli_version: "0.0.0",
      pid: 999_999,
      command: "zitadel-server",
      log_path: join(dir, ".zitadel/local/server.log"),
      server_package: "@zitadel/server",
      server_version: "0.0.0",
    }),
  );
  return port;
}

/**
 * Builds a well-formed managed project that should pass every doctor check
 * runnable without the platform: config/secret parse + match, 0600 secret,
 * gitignore + env.example coverage, a Next.js framework signature, a valid
 * user schema, a Zitadel SDK dependency, the editor meta-schemas this CLI
 * writes, and an owning team recorded by `zitadel claim` (without it the
 * claim check warns, which is its own test below).
 */
async function makeHealthyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/meta"), { recursive: true });
  for (const file of projectMetaSchemas(cliVersion.version)) {
    await writeFile(join(cwd, file.path), file.contents);
  }
  await mkdir(join(cwd, "app/login"), { recursive: true });
  await mkdir(join(cwd, "app/register"), { recursive: true });
  await mkdir(join(cwd, "app/profile"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "demo",
      dependencies: { next: "^15", "@zitadel/sdk-next": "latest" },
    }),
  );
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify({
      project: "proj-001",
      server: "https://api.zitadel.cloud",
      framework: { id: "next" },
    }),
  );
  await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj-001",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_preview",
      primary_origins: [],
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
      claimed_at: "2026-01-02T00:00:00.000Z",
      team_id: "team-001",
    }),
  );
  await chmod(join(cwd, ".zitadel/secret"), 0o600);
  await writeFile(
    join(cwd, ".gitignore"),
    [".zitadel/secret", ".env*", "!.env.example"].join("\n"),
  );
  await writeFile(
    join(cwd, ".env.example"),
    ["ZITADEL_PROJECT_ID=", "ZITADEL_ENVIRONMENT=", "ZITADEL_ISSUER="].join("\n"),
  );
  await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify(VALID_USER_SCHEMA));
  await writeFile(
    join(cwd, "app/login/page.tsx"),
    `${MANAGED_MARKER}\nexport default function L() {}\n`,
  );
  await writeFile(
    join(cwd, "app/register/page.tsx"),
    `${MANAGED_MARKER}\nexport default function R() {}\n`,
  );
  await writeFile(
    join(cwd, "app/profile/page.tsx"),
    `${MANAGED_MARKER}\nexport default function P() {}\n`,
  );
  await writeFile(
    join(cwd, "middleware.ts"),
    `${MANAGED_MARKER}\nexport function middleware() {}\n`,
  );
  await writeFile(join(cwd, "custom-elements.d.ts"), `${MANAGED_MARKER}\nexport {};\n`);
  return cwd;
}

/**
 * Rewrites the secret without `claimed_at`/`team_id`, i.e. a project that has
 * been set up but never claimed — the state every project starts in. The
 * creation time defaults to recent so the claim window reads as open.
 */
async function writeDetachedSecret(
  cwd: string,
  createdAt = new Date(Date.now() - 60_000).toISOString(),
): Promise<void> {
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj-001",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_preview",
      primary_origins: [],
      preview_origins: [],
      created_at: createdAt,
    }),
  );
  await chmod(join(cwd, ".zitadel/secret"), 0o600);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("doctor command", () => {
  it("passes every check for a well-formed managed project", async () => {
    const cwd = await makeHealthyProject();
    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[] };
    };
    expect(json.status).toBe("ok");
    expect(json.data.ok).toBe(true);
    expect(json.data.checks.every((check) => check.status === "pass")).toBe(true);
    // Sanity: the full battery actually ran, and the page checks are gone.
    const names = json.data.checks.map((check) => check.name);
    expect(names).toContain("config");
    expect(names).toContain("secret");
    expect(names).toContain("dependency");
    expect(names).toContain("project-match");
    expect(names).toContain("claim");
    expect(names).not.toContain("managed-login");
    expect(names).not.toContain("managed-register");
    expect(names).not.toContain("managed-middleware");
  });

  // The nudge has to stay advisory: doctor throws E_VALIDATION on any `fail`,
  // so failing here would break every scripted `zitadel doctor` run against a
  // project nobody has attached to a team yet.
  it("warns (but passes) when the project is not attached to a team, and points at claim", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[]; next_commands?: string[] };
    };
    expect(json.status).toBe("ok");
    expect(json.data.ok).toBe(true);
    const claim = json.data.checks.find((check) => check.name === "claim");
    expect(claim?.status).toBe("warn");
    expect(claim?.message).toContain("temporary and its data may be lost");
    // The nudge carries doctor's own --server so claim reconciles the project
    // on the server doctor checked, not the default environment.
    expect(json.data.next_commands).toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  it("suggests the claim on the project's own server, not the one doctor was pointed at", async ({
    port,
  }) => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    const fake = await fakeDocker();

    const res = await runCliForTest(
      [
        "doctor",
        "--cwd",
        cwd,
        "--json",
        "--port",
        String(port),
        "--server",
        "https://self.example",
      ],
      { PATH: `${fake.binDir}:${process.env.PATH ?? ""}`, DOCKER_LOG: fake.logPath },
    );

    const data = (parseJson(res.stdout) as { data: { next_commands?: string[] } }).data;
    expect(data.next_commands).toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  it("does not pin the claim to a file that names the project but not its secret", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    await writeFile(join(cwd, ".env.development.local"), "ZITADEL_PROJECT_ID=proj-001\n");

    const res = await doctor(cwd);

    const data = (parseJson(res.stdout) as { data: { next_commands?: string[] } }).data;
    expect((data.next_commands ?? []).some((command) => command.includes("--env-file"))).toBe(
      false,
    );
  });

  it("reports an unparseable zitadel.json as a failed config check rather than failing itself", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(join(cwd, "zitadel.json"), "{");

    const res = await doctor(cwd);

    const json = parseJson(res.stdout) as {
      details?: { checks?: Array<{ name: string; status: string }> };
    };
    expect(json.details?.checks?.find((check) => check.name === "config")?.status).toBe("fail");
  });

  it("suggests no claim when .env.development.local names another project", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    await writeFile(join(cwd, ".env.development.local"), "ZITADEL_PROJECT_ID=someone-else\n");

    const res = await doctor(cwd);

    const data = (parseJson(res.stdout) as { data: { next_commands?: string[] } }).data;
    expect((data.next_commands ?? []).some((command) => command.includes(" claim"))).toBe(false);
  });

  it("pins the claim it suggests to setup's file when there is one", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    await writeFile(
      join(cwd, ".env.development.local"),
      "ZITADEL_PROJECT_ID=proj-001\nZITADEL_PROJECT_SECRET=sk_test\n",
    );

    const res = await doctor(cwd);

    expect(
      (parseJson(res.stdout) as { data: { next_commands?: string[] } }).data.next_commands,
    ).toContain(
      expectedPublicCliCommand(
        `claim --env-file ${cwd}/.env.development.local --server https://api.zitadel.cloud --cwd ${cwd}`,
      ),
    );
  });

  // Same advisory posture, reconciliation wording: past the 14-day window
  // the warning explains both outcomes, and the claim command stays
  // suggested because the local record can be stale (claimed from another
  // machine reads detached) and running claim answers authoritatively.
  it("switches to reconciliation wording once the window has closed", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd, "2026-01-01T00:00:00.000Z");

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { ok: boolean; checks: Check[]; next_actions?: string[]; next_commands?: string[] };
    };
    expect(json.data.ok).toBe(true);
    const claim = json.data.checks.find((check) => check.name === "claim");
    expect(claim?.status).toBe("warn");
    expect(claim?.message).toContain("claim window has closed");
    expect((json.data.next_actions ?? []).join("\n")).toContain("claim window has closed");
    expect(json.data.next_commands ?? []).toContain(
      expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`),
    );
  });

  it("says each next step once when its output is read by a pipe", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd, "2026-01-01T00:00:00.000Z");
    const fake = await fakeDocker();

    const res = await runCliForTest(["doctor", "--cwd", cwd, "--port", String(nextPort())], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    const claim = expectedPublicCliCommand(`claim --server https://api.zitadel.cloud --cwd ${cwd}`);
    expect(stripAnsi(res.stdout).split(claim)).toHaveLength(2);
    expect(stripAnsi(res.stdout)).not.toContain("Next:");
  });

  it("says a next step that no row shows once, in what a pipe reads", async () => {
    const cwd = await makeHealthyProject();
    const fake = await fakeDocker();

    const res = await runCliForTest(
      ["doctor", "--cwd", cwd, "--port", String(nextPort())],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
      undefined,
      aMachineRunning({
        pid: 999_991,
        ppid: 1,
        command: "/usr/local/bin/node /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
      }),
    );

    const stop = expectedPublicCliCommand("stop --all");
    expect(stripAnsi(res.stdout).split(stop)).toHaveLength(2);
  });

  // Claiming needs a human in a browser, so --fix has nothing safe to do. The
  // warning has to survive it rather than being silently "repaired".
  it("leaves the claim warning (and the secret) alone under --fix", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    const before = await readFile(join(cwd, ".zitadel/secret"), "utf8");

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { ok: boolean; checks: Check[] } };
    expect(json.data.checks.find((check) => check.name === "claim")?.status).toBe("warn");
    expect(await readFile(join(cwd, ".zitadel/secret"), "utf8")).toBe(before);
  });

  // A local project's claim depends on server state this offline check
  // cannot see (platform.bootstrap_project), so the nudge must not follow
  // `zitadel setup --server local` around; setup probes the server instead.
  it("passes the claim check without a nudge for a local project", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "http://localhost:8080",
        framework: { id: "next" },
      }),
    );

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { checks: Check[]; next_commands?: string[] };
    };
    expect(json.data.checks.find((check) => check.name === "claim")?.status).toBe("pass");
    expect(json.data.next_commands ?? []).not.toContain(expectedPublicCliCommand("claim"));
  });

  // The skew stays advisory (the app keeps working on its pinned train), and
  // the repair must be a structured next_command — the agent contract prefers
  // that field over prose — using the project's package manager with an
  // exact-save flag so the repair cannot float the pin.
  it("warns on a trailing SDK pin and emits the exact-pin repair in next_commands", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { next: "^15", "@zitadel/sdk-next": "0.0.1" },
      }),
    );

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      cli_version: string;
      data: { ok: boolean; checks: Check[]; next_commands?: string[] };
    };
    expect(json.data.ok).toBe(true);
    expect(json.data.checks.find((check) => check.name === "dependency-version")?.status).toBe(
      "warn",
    );
    expect(json.data.next_commands).toContain(
      `npm install --save-exact @zitadel/sdk-next@${json.cli_version}`,
    );
  });

  it("warns (but passes) when .zitadel/schemas is empty — legacy or interrupted projects", async () => {
    const cwd = await makeHealthyProject();
    await rm(join(cwd, ".zitadel/schemas/user.json"));

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[] };
    };
    expect(json.status).toBe("ok");
    expect(json.data.ok).toBe(true);
    const schemaCheck = json.data.checks.find((check) => check.name === "schema");
    expect(schemaCheck?.status).toBe("warn");
    expect(schemaCheck?.message).toContain("No schema files found");
  });

  it("fails the dependency check when no @zitadel package is present", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    );

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      details: { checks: Check[] };
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    const dependency = json.details.checks.find((check) => check.name === "dependency");
    expect(dependency?.status).toBe("fail");
  });

  it("reports actionable recovery commands when the local runtime port is occupied", async ({
    serve,
  }) => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-port-"));
    tempDirs.push(cwd);
    const occupiedUrl = await startHealthServer(serve);
    const occupiedPort = Number(new URL(occupiedUrl).port);

    const fake = await fakeDocker();
    // The port probe shells out to `lsof` and degrades to "no listeners" on
    // ANY failure by contract (ports.ts), so asserting through the real
    // system lsof makes this test environment-dependent — the listener
    // silently vanished on CI runners. Fake lsof on the PATH the test
    // already owns so the occupied port is always visible.
    const lsofPath = join(fake.binDir, "lsof");
    await writeFile(
      lsofPath,
      `#!/usr/bin/env node
console.log(["p4242", "cnode", "n127.0.0.1:" + process.env.LSOF_FIXTURE_PORT].join("\\n"));
`,
    );
    await chmod(lsofPath, 0o755);
    const res = await runCliForTest(
      [
        "doctor",
        "--cwd",
        cwd,
        "--json",
        "--port",
        String(occupiedPort),
        "--server",
        "https://api.zitadel.cloud",
      ],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
        LSOF_FIXTURE_PORT: String(occupiedPort),
      },
    );

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_PORT_IN_USE");
    expect(json.next_commands).toEqual([
      expect.stringContaining("stop --all"),
      expect.stringContaining("doctor"),
      expect.stringContaining("doctor --port"),
    ]);
    expect(json.hint).toContain(json.next_commands?.[0]);
  });

  // A project `setup --server <hosted>` created runs no local server, so the
  // local runtime says nothing about it, and a port another app holds must not
  // fail it.
  describe("for a project set up against a hosted server", () => {
    it("checks no local runtime", async () => {
      const cwd = await makeHealthyProject();

      const res = await doctorWithoutPort(cwd);

      expect(checkNamesOf(res.stdout).filter((name) => LOCAL_RUNTIME_CHECKS.has(name))).toEqual([]);
    });

    it("reports no local port", async () => {
      const cwd = await makeHealthyProject();

      const res = await doctorWithoutPort(cwd);

      expect((parseJson(res.stdout) as { data: { port?: number } }).data.port).toBeUndefined();
    });

    it("reports the project's server as its source", async () => {
      const cwd = await makeHealthyProject();
      await setProjectServer(cwd, "https://hosted.example.com");

      const res = await doctorWithoutPort(cwd);

      expect((parseJson(res.stdout) as { source: string }).source).toBe(
        "https://hosted.example.com",
      );
    });

    it("checks the local runtime a flag asks about", async () => {
      const cwd = await makeHealthyProject();

      const res = await doctor(cwd);

      expect(checkNamesOf(res.stdout)).toContain("port");
    });

    it("checks a local server started in its directory", async ({ serve }) => {
      const cwd = await makeHealthyProject();
      await recordStartedServer(serve, cwd);

      const res = await doctorWithoutPort(cwd);

      expect(checkNamesOf(res.stdout)).toContain("runtime");
    });
  });

  it("checks the local runtime of a project set up against a local server", async ({ port }) => {
    const cwd = await makeHealthyProject();
    await setProjectServer(cwd, `http://localhost:${String(port)}`);

    const res = await doctorWithoutPort(cwd);

    expect(checkNamesOf(res.stdout)).toContain("port");
  });

  it("checks the local runtime before setup", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-empty-"));
    tempDirs.push(cwd);

    const res = await doctorWithoutPort(cwd);

    expect(checkNamesOf(res.stdout)).toContain("port");
  });

  // `zitadel start` tells developers to run setup in the directory it ran in,
  // or one inside it; doctor must check that server, not the default port.
  describe("in an app inside the directory a local server was started in", () => {
    async function appUnderStartedServer(serve: Serve): Promise<{ app: string; port: number }> {
      const parent = await mkdtemp(join(tmpdir(), "zitadel-doctor-parent-"));
      tempDirs.push(parent);
      const port = await recordStartedServer(serve, parent);
      const app = join(parent, "app");
      await mkdir(app);
      return { app, port };
    }

    it("checks that server's port", async ({ serve }) => {
      const { app, port } = await appUnderStartedServer(serve);

      const res = await doctorWithoutPort(app);

      expect((parseJson(res.stdout) as { data: { port: number } }).data.port).toBe(port);
    });

    it("reports that server healthy", async ({ serve }) => {
      const { app } = await appUnderStartedServer(serve);

      const res = await doctorWithoutPort(app);

      const checks = (parseJson(res.stdout) as { data: { checks: Check[] } }).data.checks;
      expect(checks.find((check) => check.name === "runtime")).toMatchObject({
        status: "pass",
        message: expect.stringContaining("is healthy"),
      });
    });

    it("names the parent folder the healthy server was started in", async ({ serve }) => {
      const { app } = await appUnderStartedServer(serve);

      const res = await doctorWithoutPort(app);

      const checks = (parseJson(res.stdout) as { data: { checks: Check[] } }).data.checks;
      expect(checks.find((check) => check.name === "runtime")?.message).toContain(
        `(server started in the parent folder ${dirname(app)})`,
      );
    });

    it("points at that server's log", async ({ serve }) => {
      const { app } = await appUnderStartedServer(serve);

      const res = await doctorWithoutPort(app);

      const data = (parseJson(res.stdout) as { data: { next_actions?: string[] } }).data;
      expect(data.next_actions).toContainEqual(expect.stringContaining(" logs --follow"));
    });
  });

  it("points at no server log where no server was started", async () => {
    const cwd = await makeHealthyProject();

    const res = await doctor(cwd);

    expect(res.stdout).not.toContain("logs --follow");
  });

  it("fails the project-match check when secret and config disagree", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "different-id",
        project_secret: "sk_proj_test",
        preview_secret: "sk_proj_preview",
        primary_origins: [],
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    await chmod(join(cwd, ".zitadel/secret"), 0o600);

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { details: { checks: Check[] } };
    const match = json.details.checks.find((check) => check.name === "project-match");
    expect(match?.status).toBe("fail");
  });

  it("re-locks loose secret permissions via --fix and then passes", async () => {
    const cwd = await makeHealthyProject();
    await chmod(join(cwd, ".zitadel/secret"), 0o644);

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[] };
    };
    expect(json.status).toBe("ok");
    const perms = json.data.checks.find((check) => check.name === "secret-permissions");
    expect(perms?.status).toBe("pass");
  });

  it("reports E_VALIDATION (not a crash) when --fix cannot repair a broken project", async () => {
    const cwd = await makeHealthyProject();
    // project-match has no auto-repair: a secret/config project_id mismatch
    // stays failed through --fix, so doctor must report E_VALIDATION rather
    // than crash.
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "mismatch",
        project_secret: "sk_proj_test",
        preview_secret: "sk_proj_preview",
        primary_origins: [],
        preview_origins: [],
      }),
    );
    await chmod(join(cwd, ".zitadel/secret"), 0o600);

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      details: { checks: Check[] };
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.details.checks.find((check) => check.name === "project-match")?.status).toBe(
      "fail",
    );
  });

  it("fails when a scaffolded infrastructure file is missing and --fix restores it", async () => {
    const cwd = await makeHealthyProject();
    await rm(join(cwd, "middleware.ts"));

    const broken = await doctor(cwd);
    expect(broken.exitCode).toBe(3);
    const brokenJson = parseJson(broken.stdout) as {
      status: string;
      code: string;
      details: { checks: Check[] };
    };
    expect(brokenJson.status).toBe("error");
    expect(brokenJson.code).toBe("E_VALIDATION");
    const drift = brokenJson.details.checks.find((check) => check.name === "managed-files");
    expect(drift?.status).toBe("fail");
    expect(drift?.message).toContain("middleware.ts");

    const fixed = await doctor(cwd, ["--fix"]);
    expect(fixed.exitCode).toBe(0);
    const fixedJson = parseJson(fixed.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[] };
    };
    expect(fixedJson.status).toBe("ok");
    expect(fixedJson.data.ok).toBe(true);
    expect(fixedJson.data.checks.find((check) => check.name === "managed-files")?.status).toBe(
      "pass",
    );
    expect(await readFile(join(cwd, "middleware.ts"), "utf8")).toContain(MANAGED_MARKER);
  });

  it("warns on a missing scaffolded page and --fix restores it", async () => {
    const cwd = await makeHealthyProject();
    await rm(join(cwd, "app/login/page.tsx"));

    const warned = await doctor(cwd);
    expect(warned.exitCode).toBe(0);
    const warnedJson = parseJson(warned.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[] };
    };
    expect(warnedJson.data.ok).toBe(true);
    expect(warnedJson.data.checks.find((check) => check.name === "managed-files")?.status).toBe(
      "warn",
    );

    const fixed = await doctor(cwd, ["--fix"]);
    expect(fixed.exitCode).toBe(0);
    const fixedJson = parseJson(fixed.stdout) as { data: { checks: Check[] } };
    expect(fixedJson.data.checks.find((check) => check.name === "managed-files")?.status).toBe(
      "pass",
    );
    expect(await readFile(join(cwd, "app/login/page.tsx"), "utf8")).toContain(MANAGED_MARKER);
  });

  it("re-applies a missing Zitadel dependency via --fix and then passes", async () => {
    const cwd = await makeHealthyProject();
    // Drop the SDK dependency; repair re-adds it via its `add-dep` op.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    );

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { ok: boolean; checks: Check[] };
    };
    expect(json.status).toBe("ok");
    expect(json.data.ok).toBe(true);
    const dependency = json.data.checks.find((check) => check.name === "dependency");
    expect(dependency?.status).toBe("pass");
  });

  // It never opens a connection, so nothing else records where it ran; the
  // project comes from `.zitadel/secret` and the server from `zitadel.json`.
  it("names the project it checked, not only the server", async () => {
    const cwd = await makeHealthyProject();
    const fake = await fakeDocker();

    const res = await asTerminal(() =>
      runCliForTest(["doctor", "--cwd", cwd, "--port", String(nextPort())], {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      }),
    );

    expect(stripAnsi(res.stdout)).toContain(
      "All checks passed · project proj-001 on api.zitadel.cloud",
    );
    expect(stripAnsi(res.stdout)).not.toContain("Using project proj-001");
  });

  it("titles its --json answer with the title a terminal shows", async () => {
    const cwd = await makeHealthyProject();

    const res = await doctor(cwd);

    expect(parseJson(res.stdout)).toMatchObject({
      data: {
        title: "All checks passed",
      },
    });
  });

  it("says its verdict on a terminal once, in its title", async () => {
    const cwd = await makeHealthyProject();
    const fake = await fakeDocker();

    const res = await asTerminal(() =>
      runCliForTest(["doctor", "--cwd", cwd, "--port", String(nextPort())], {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      }),
    );

    expect(stripAnsi(res.stdout)).not.toContain("Zitadel doctor passed");
  });
});

async function fakeDocker(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
  tempDirs.push(binDir);
  const logPath = join(binDir, "docker.log");
  const dockerPath = join(binDir, "docker");
  const psPath = join(binDir, "ps");
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  console.log("29.0.0");
  process.exit(0);
}
if (args[0] === "pull") {
  console.log(args[args.length - 1]);
  process.exit(0);
}
process.exit(0);
`,
  );
  await chmod(dockerPath, 0o755);
  await writeFile(psPath, "#!/usr/bin/env node\nprocess.exit(0);\n");
  await chmod(psPath, 0o755);
  return { binDir, logPath };
}

function startHealthServer(serve: Serve): Promise<string> {
  return serve((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  }, "127.0.0.1");
}

describe("doctor's managed runtime process check", () => {
  const HOST_WIDE_SERVER = {
    pid: 999_991,
    ppid: 1,
    command: "/usr/local/bin/node /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
  };

  /** A `ps` that fails, so a doctor that reads the host's processes cannot find them supported. */
  async function failingPs(): Promise<string> {
    const binDir = await mkdtemp(join(tmpdir(), "zitadel-failing-ps-"));
    tempDirs.push(binDir);
    await writeFile(join(binDir, "ps"), "#!/usr/bin/env node\nprocess.exit(1);\n");
    await chmod(join(binDir, "ps"), 0o755);
    return binDir;
  }

  async function doctorOn(servers: LocalServers) {
    const cwd = await makeHealthyProject();
    const fake = await fakeDocker();
    const res = await runCliForTest(
      [
        "doctor",
        "--cwd",
        cwd,
        "--json",
        "--port",
        String(nextPort()),
        "--server",
        "https://api.zitadel.cloud",
      ],
      {
        PATH: `${await failingPs()}:${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
      undefined,
      servers,
    );
    return parseJson(res.stdout);
  }

  it("reports the servers of the machine it is given", async () => {
    const json = await doctorOn(aMachineRunning(HOST_WIDE_SERVER));

    expect(json).toMatchObject({
      data: {
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "managed-runtime-processes",
            status: "warn",
            details: {
              supported: true,
              scope: "host",
              processes: [expect.objectContaining({ pid: 999_991 })],
            },
          }),
        ]),
      },
    });
  });

  it("reports none for a machine running none, whatever the host runs", async () => {
    const json = await doctorOn(aMachineRunning());

    expect(json).toMatchObject({
      data: {
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "managed-runtime-processes",
            status: "pass",
            details: { supported: true, scope: "host", processes: [] },
          }),
        ]),
      },
    });
  });
});

describe("advisoryForWarnings", () => {
  const claimWarning = {
    name: "claim",
    status: "warn" as const,
    message: "temporary",
    details: { claimable: true },
  };

  it("suggests claiming the local project on the server doctor checked", () => {
    const advice = advisoryForWarnings(
      [claimWarning],
      aSuggest({}, cliVersion.version),
      aSuggest({ server: "https://a.example" }, cliVersion.version),
    );

    expect(advice?.nextCommands).toEqual([
      expectedPublicCliCommand("claim --server https://a.example"),
    ]);
  });

  it("adds no selector to the claim when doctor named no server or directory", () => {
    const advice = advisoryForWarnings(
      [claimWarning],
      aSuggest({}, cliVersion.version),
      aSuggest({}, cliVersion.version),
    );

    expect(advice?.nextCommands).toEqual([expectedPublicCliCommand("claim")]);
  });

  it("suggests doctor --fix for outdated editor schemas in the directory doctor checked", () => {
    const metaWarning = {
      name: "meta-schemas",
      status: "warn" as const,
      message: "outdated",
      details: { missing: [], outdated: [".zitadel/meta/branding.json"] },
    };

    const advice = advisoryForWarnings(
      [metaWarning],
      aSuggest({ cwd: "apps/web" }, cliVersion.version),
      undefined,
    );

    expect(advice?.nextCommands).toEqual([expectedPublicCliCommand("doctor --fix --cwd apps/web")]);
  });

  it("does not suggest doctor --fix for an editor schema it cannot read", () => {
    const metaWarning = {
      name: "meta-schemas",
      status: "warn" as const,
      message: "unreadable",
      details: {
        missing: [],
        outdated: [],
        unreadable: [{ path: ".zitadel/meta/branding.json", reason: "EACCES" }],
      },
    };

    const advice = advisoryForWarnings([metaWarning], aSuggest({}, cliVersion.version), undefined);

    expect(advice).toBeUndefined();
  });

  it("does not suggest this CLI's doctor --fix when the project pins a newer version", () => {
    const metaWarning = {
      name: "meta-schemas",
      status: "warn" as const,
      message: "newer",
      details: {
        missing: [],
        outdated: [".zitadel/meta/branding.json"],
        newer_pin: { name: "@zitadel/sdk-next", version: "9.9.9" },
      },
    };

    const advice = advisoryForWarnings([metaWarning], aSuggest({}, cliVersion.version), undefined);

    expect(advice).toBeUndefined();
  });

  it("suggests doctor --fix --force for an issuer held as a preview origin, in the directory doctor checked", () => {
    const issuerWarning = {
      name: "issuer-origin",
      status: "warn" as const,
      message: "preview",
      details: { pattern: "http://localhost:3000", server: "https://api.zitadel.cloud" },
    };

    const advice = advisoryForWarnings(
      [issuerWarning],
      aSuggest({ cwd: "apps/web" }, cliVersion.version),
      undefined,
    );

    expect(advice?.nextCommands).toEqual([
      expectedPublicCliCommand("doctor --fix --force --cwd apps/web"),
    ]);
  });
});

describe("failureAdvice for a runtime found in a parent directory", () => {
  const SUGGEST = aSuggest({}, "1.0.0");
  const SUGGEST_WORDS = aSuggestWords();
  const failed = [{ name: "runtime", status: "fail" as const, message: "not healthy" }];

  it.each([
    ["a Windows path with a space", "C:\\work\\my app", "'C:\\work\\my app'"],
    ["a Windows path with an apostrophe", "C:\\work\\it's", "'C:\\work\\it'\\''s'"],
    ["a POSIX path with a space", "/home/dev/my app", "'/home/dev/my app'"],
  ])(
    "quotes %s in the commands and hands it over as it is in the arguments",
    (_name, dir, quoted) => {
      const advice = failureAdvice(failed, "image", 8080, SUGGEST, SUGGEST_WORDS, dir);

      expect(advice.nextCommands).toEqual([
        publicCliCommand(`start --cwd ${quoted}`, "1.0.0"),
        publicCliCommand("start", "1.0.0"),
        publicCliCommand(`reset --force --cwd ${quoted}`, "1.0.0"),
      ]);
      expect(advice.suggestedArgs).toEqual([
        ["start", "--cwd", dir],
        ["start"],
        ["reset", "--force", "--cwd", dir],
      ]);
    },
  );

  it("writes the commands out for a path that needs no quoting", () => {
    const advice = failureAdvice(failed, "image", 8080, SUGGEST, SUGGEST_WORDS, "/home/dev/app");

    expect(advice.nextCommands).toEqual([
      publicCliCommand("start --cwd /home/dev/app", "1.0.0"),
      publicCliCommand("start", "1.0.0"),
      publicCliCommand("reset --force --cwd /home/dev/app", "1.0.0"),
    ]);
  });

  it("says the server is the parent's and that a reset deletes the parent's data", () => {
    const advice = failureAdvice(failed, "image", 8080, SUGGEST, SUGGEST_WORDS, "/home/dev/app");

    expect(advice.hint).toContain("This folder has no Zitadel server of its own");
    expect(advice.hint).toContain("the parent folder, /home/dev/app");
    expect(advice.hint).toContain("Resetting deletes the local data in /home/dev/app");
    expect(advice.hint).toContain("run start here");
  });

  it("starts a server in doctor's own --cwd, not the shell's directory", () => {
    const advice = failureAdvice(
      failed,
      "image",
      8080,
      aSuggest({ cwd: "/home/dev/app/child" }, "1.0.0"),
      aSuggestWords({ cwd: "/home/dev/app/child" }),
      "/home/dev/app",
    );

    expect(advice.suggestedArgs?.[1]).toEqual(["start", "--cwd", "/home/dev/app/child"]);
  });

  it("keeps the hint to one line", () => {
    const advice = failureAdvice(failed, "image", 8080, SUGGEST, SUGGEST_WORDS, "/home/dev/app");

    expect(advice.hint).not.toContain("\n");
  });

  it("keeps the plain advice for a runtime in the working directory", () => {
    const advice = failureAdvice(failed, "image", 8080, SUGGEST, SUGGEST_WORDS);

    expect(advice.hint).not.toContain("parent folder");
    expect(advice.nextCommands).toEqual([
      publicCliCommand("start", "1.0.0"),
      publicCliCommand("reset --force", "1.0.0"),
    ]);
  });
});
