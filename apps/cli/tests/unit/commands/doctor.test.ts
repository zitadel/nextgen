import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MANAGED_MARKER } from "../../../src/lib/paths";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../helpers/run-cli";

type Check = { name: string; status: "pass" | "warn" | "fail"; message: string; path?: string };

const tempDirs: string[] = [];
const servers: Server[] = [];

const VALID_USER_SCHEMA = {
  kind: "user-schema",
  metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
  "x-auth-methods": { password: { enabled: true, position: 0 } },
  properties: { email: { type: "string" } },
};

async function doctor(cwd: string, extra: string[] = []) {
  const fake = await fakeDocker();
  const port = await freePort();
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

/**
 * Builds a well-formed managed project that should pass every doctor check
 * runnable without the platform: config/secret parse + match, 0600 secret,
 * gitignore + env.example coverage, a Next.js framework signature, a valid
 * user schema, a Zitadel SDK dependency, and an owning team recorded by
 * `zitadel claim` (without it the claim check warns, which is its own test
 * below).
 */
async function makeHealthyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
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
      environments: { development: { issuer: "http://localhost:3000" } },
    }),
  );
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj-001",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_preview",
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
 * been set up but never claimed — the state every project starts in.
 */
async function writeDetachedSecret(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj-001",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  await chmod(join(cwd, ".zitadel/secret"), 0o600);
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
    expect(claim?.message).toContain("temporary until you attach it to a team");
    expect(json.data.next_commands).toContain(expectedPublicCliCommand("claim"));
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

  // A local project has no platform team to attach to, so the nudge must not
  // follow `zitadel setup --server local` around forever.
  it("passes the claim check without a nudge for a local project", async () => {
    const cwd = await makeHealthyProject();
    await writeDetachedSecret(cwd);
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "http://localhost:8080",
        framework: { id: "next" },
        environments: { development: { issuer: "http://localhost:3000" } },
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

  it("reports actionable recovery commands when the local runtime port is occupied", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-port-"));
    tempDirs.push(cwd);
    const occupiedUrl = await startHealthServer();
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

  it("fails the project-match check when secret and config disagree", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "different-id",
        project_secret: "sk_proj_test",
        preview_secret: "sk_proj_preview",
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
    expect(
      fixedJson.data.checks.find((check) => check.name === "managed-files")?.status,
    ).toBe("pass");
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
    expect(
      warnedJson.data.checks.find((check) => check.name === "managed-files")?.status,
    ).toBe("warn");

    const fixed = await doctor(cwd, ["--fix"]);
    expect(fixed.exitCode).toBe(0);
    const fixedJson = parseJson(fixed.stdout) as { data: { checks: Check[] } };
    expect(
      fixedJson.data.checks.find((check) => check.name === "managed-files")?.status,
    ).toBe("pass");
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

async function startHealthServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("health server did not expose a TCP address");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("free port probe did not expose a TCP address");
  }
  return address.port;
}
