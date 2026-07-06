import { chmod, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

const MOCK_SERVER_URL = "http://mock.zitadel.test";

const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  resetPlatformStore();
});

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return runCliForTest([...args, "--server", MOCK_SERVER_URL], env);
}

describe("Next setup integration", () => {
  it("sets up, verifies, plans, applies, and preserves idempotency", async () => {
    const cwd = await createNextProject();
    const fakeNpm = await fakePackageManager("npm");

    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json"], {
      PACKAGE_MANAGER_LOG: fakeNpm.logPath,
      PATH: `${fakeNpm.binDir}:${process.env.PATH ?? ""}`,
    });
    expect(setup.exitCode).toBe(0);
    const setupJson = parseJson(setup.stdout) as {
      status: string;
      data: {
        install: { status: string; package_manager: string; command: string };
        files_written: string[];
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(setupJson.status).toBe("ok");
    expect(setup.stdout).not.toContain("fake npm stdout");
    expect(setup.stderr).toContain("fake npm stdout");
    expect(setup.stderr).toContain("fake npm stderr");
    expect(setupJson.data.install).toMatchObject({
      status: "completed",
      package_manager: "npm",
      command: "npm install",
    });
    expect(setupJson.data.next_commands).toEqual(["npm run dev"]);
    expect(setupJson.data.next_actions.join("\n")).toContain("register a user");
    expect(setupJson.data.next_actions.join("\n")).toContain("log in again");
    expect(setupJson.data.next_actions.join("\n")).toContain("/profile shows Signed in");
    expect(setupJson.data.files_written).toContain(".zitadel/schemas/default-human-user.json");
    expect(setupJson.data.files_written).toContain(".zitadel/flows/default-login.json");
    const installLog = JSON.parse((await readFile(fakeNpm.logPath, "utf8")).trim()) as {
      cwd: string;
      args: string[];
    };
    expect(installLog).toEqual({ cwd: await realpath(cwd), args: ["install"] });

    // Setup scaffolds the default schema and flow locally, uploads those files
    // through the resource APIs, and seeds sync state with the returned
    // ids/hashes, so `plan` is immediately empty.
    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"project"');
    const schema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "utf8"),
    ) as {
      "$id": string;
      kind: string;
      properties: Record<string, unknown>;
    };
    expect(schema.kind).toBe("user-schema");
    expect(schema["$id"]).toBe("https://nextgen.com/api/schemas/default-human-user.json");
    expect(schema.properties).toHaveProperty("email");
    const flow = JSON.parse(
      await readFile(join(cwd, ".zitadel/flows/default-login.json"), "utf8"),
    ) as {
      name: string;
      user_schema: string;
      purposes: Record<string, string>;
    };
    expect(flow.name).toBe("default-login");
    expect(flow.user_schema).toBe(schema["$id"]);
    expect(flow.purposes).toMatchObject({ login: "identifier", register: "register" });
    expect(snapshotPlatformStore()).toMatchObject({
      projects: 1,
      schemas: 1,
      flowDefinitions: 1,
      schemaIds: [schema["$id"]],
    });
    const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      resources: Record<string, { id?: string; hash?: string; name?: string; status?: string }>;
    };
    expect(state.resources[".zitadel/schemas/default-human-user.json"]).toMatchObject({
      id: schema["$id"],
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(state.resources[".zitadel/flows/default-login.json"]).toMatchObject({
      id: expect.stringMatching(/^flow_/),
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      name: "default-login",
      status: "active",
    });
    const loginPage = await readFile(join(cwd, "app/login/page.tsx"), "utf8");
    expect(loginPage).toContain("zitadel-cli: managed-file v1");
    expect(loginPage).toContain('"use client"');
    expect(loginPage).toContain('purpose="login"');
    expect(loginPage).toContain("<zitadel-login");
    // The SDK handle is built (proxy path + project id from the public env
    // var) and passed to the component via the `project` prop; the backend URL
    // stays server-side.
    expect(loginPage).toContain("configureZitadel");
    expect(loginPage).toContain('proxyPath: "/__nextgen"');
    expect(loginPage).toContain("project={project}");
    expect(loginPage).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(loginPage).toContain('post-sign-in-url="/profile"');
    expect(loginPage).toContain('href="/register"');
    expect(loginPage).not.toContain('href="/profile"');
    const registerPage = await readFile(join(cwd, "app/register/page.tsx"), "utf8");
    expect(registerPage).toContain('purpose="register"');
    expect(registerPage).toContain('href="/login"');
    expect(registerPage).not.toContain('href="/profile"');
    const profilePage = await readFile(join(cwd, "app/profile/page.tsx"), "utf8");
    expect(profilePage).toContain("zitadel-cli: managed-file v1");
    expect(profilePage).toContain("<zitadel-session");
    expect(profilePage).toContain("configureZitadel");
    expect(profilePage).toContain("project={project}");
    expect(profilePage).toContain('post-sign-out-url="/login"');
    const proxy = await readFile(join(cwd, "proxy.ts"), "utf8");
    expect(proxy).toContain("zitadel-cli: managed-file v1");
    expect(proxy).toContain("nextgenMiddleware");
    expect(proxy).toContain("export function proxy(");
    expect(proxy).toContain('protectedRoutes: ["/profile"]');
    expect(proxy).toContain('"/__nextgen/:path*"');
    expect(proxy).toContain("process.env.ZITADEL_URL");
    const envLocal = await readFile(join(cwd, ".env.local"), "utf8");
    expect(envLocal).toContain("ZITADEL_ENVIRONMENT=development");
    expect(envLocal).toContain("ZITADEL_URL=");
    expect(envLocal).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(envLocal).toContain("NEXT_PUBLIC_ZITADEL_PROJECT_ID=");
    // The dev proxy/middleware sends the project service-key secret as the
    // bearer; the SPA framework patchers read it from .env.local server-side.
    // .env.local is gitignored, so the secret never leaves the machine.
    expect(envLocal).toContain("ZITADEL_PROJECT_SECRET=");
    expect(envLocal).not.toContain("ZITADEL_PREVIEW_SECRET");
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);
    const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["@zitadel/sdk-next"]).toBe(await expectedCliVersion());

    const fake = await fakeDocker();
    const port = await freePort();
    const doctor = await cli(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });
    expect(doctor.exitCode).toBe(0);
    expect((parseJson(doctor.stdout) as { status: string }).status).toBe("ok");

    const noArg = await cli(["status", "--cwd", cwd, "--json"]);
    expect(noArg.exitCode).toBe(0);
    const status = parseJson(noArg.stdout) as {
      status: string;
      data: { next_commands: string[] };
    };
    expect(status.status).toBe("ok");
    expect(status.data.next_commands.join(" ")).toContain("apply");

    const rerun = await cli(["setup", "--cwd", cwd, "--json"]);
    expect(rerun.exitCode).toBe(0);
    expect((parseJson(rerun.stdout) as { status: string }).status).toBe("skipped");

    const stateBeforePlan = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    const plan = await cli(["plan", "--cwd", cwd, "--json"]);
    expect(plan.exitCode).toBe(0);
    const planJson = parseJson(plan.stdout) as {
      status: string;
      data: { creates: number; updates: number; deletes: number; total: number };
    };
    expect(planJson.status).toBe("ok");
    expect(planJson.data).toMatchObject({ creates: 0, updates: 0, deletes: 0, total: 0 });
    expect(await readFile(join(cwd, ".zitadel/state.json"), "utf8")).toBe(stateBeforePlan);

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(0);
    const applyJson = parseJson(apply.stdout) as { status: string; data: { synced: boolean } };
    expect(applyJson.status).toBe("ok");
    expect(applyJson.data.synced).toBe(true);
  });

  it("skips rerun setup without rewriting edited schema or flow config", async () => {
    const cwd = await createNextProject();
    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    expect(setup.exitCode).toBe(0);

    const flowPath = join(cwd, ".zitadel/flows/default-login.json");
    const schemaPath = join(cwd, ".zitadel/schemas/default-human-user.json");
    const editedFlow = `${await readFile(flowPath, "utf8")}\n`;
    const editedSchema = `${await readFile(schemaPath, "utf8")}\n`;
    await writeFile(flowPath, editedFlow);
    await writeFile(schemaPath, editedSchema);

    const rerun = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    expect(rerun.exitCode).toBe(0);
    expect((parseJson(rerun.stdout) as { status: string }).status).toBe("skipped");
    await expect(readFile(flowPath, "utf8")).resolves.toBe(editedFlow);
    await expect(readFile(schemaPath, "utf8")).resolves.toBe(editedSchema);
  });

  it("fails apply clearly for missing env refs", async () => {
    const cwd = await createNextProject();
    await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);

    const flowWithEnvRef = {
      // Spec: `name` is the slug-pattern stable identifier; required fields
      // are [name, status, user_schema, purposes, steps]. `purposes` is a map
      // from purpose name to entry-point step name.
      name: "default",
      status: "active",
      user_schema:
        "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          fields: [],
          actions: [],
          gates: {
            captcha: {
              kind: "captcha",
              provider: "altcha",
              config: { client_secret_env: "MY_CAPTCHA_SECRET" },
            },
          },
        },
      ],
    };
    await writeFile(
      join(cwd, ".zitadel/flows/default.json"),
      JSON.stringify(flowWithEnvRef, null, 2),
    );

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(3);
    const applyJson = parseJson(apply.stdout) as { code: string; message: string };
    expect(applyJson.code).toBe("E_VALIDATION");
    expect(applyJson.message).toContain("Missing environment variables");

    const applyWithEnv = await cli(["apply", "--cwd", cwd, "--json"], {
      MY_CAPTCHA_SECRET: "hunter2",
    });
    expect(applyWithEnv.exitCode).toBe(0);
  });

});

async function createNextProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-next-"));
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "demo-next-app",
        private: true,
        dependencies: {
          next: "^16.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(cwd, ".gitignore"), "node_modules\n");
  await writeFile(
    join(cwd, "app/layout.tsx"),
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return cwd;
}

async function fakePackageManager(name: "npm"): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-pm-"));
  const logPath = join(binDir, "package-manager.log");
  const binPath = join(binDir, name);
  await writeFile(
    binPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(
  process.env.PACKAGE_MANAGER_LOG,
  JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n",
);
process.stdout.write("fake npm stdout\\n");
process.stderr.write("fake npm stderr\\n");
process.exit(0);
`,
  );
  await chmod(binPath, 0o755);
  return { binDir, logPath };
}

async function fakeDocker(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
  const logPath = join(binDir, "docker.log");
  const dockerPath = join(binDir, "docker");
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
  return { binDir, logPath };
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

async function expectedCliVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}
