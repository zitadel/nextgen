import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MANAGED_MARKER } from "../../../src/lib/paths";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

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
 * user schema, and a Zitadel SDK dependency.
 */
async function makeHealthyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, "app/login"), { recursive: true });
  await mkdir(join(cwd, "app/register"), { recursive: true });

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
    join(cwd, "middleware.ts"),
    `${MANAGED_MARKER}\nexport function middleware() {}\n`,
  );
  return cwd;
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
    expect(names).not.toContain("managed-login");
    expect(names).not.toContain("managed-register");
    expect(names).not.toContain("managed-middleware");
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
