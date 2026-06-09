import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
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

    const setup = await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
    ]);
    expect(setup.exitCode).toBe(0);
    const setupJson = parseJson(setup.stdout) as { status: string };
    expect(setupJson.status).toBe("ok");

    // The user schema and flow are provisioned server-side when the project
    // is created, so setup does not write `.zitadel/schemas` or
    // `.zitadel/flows`; only the framework files and project config are
    // scaffolded locally.
    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"project"');
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
    const profilePage = await readFile(join(cwd, "app/profile/page.tsx"), "utf8");
    expect(profilePage).toContain("zitadel-cli: managed-file v1");
    expect(profilePage).toContain("<zitadel-logout");
    expect(profilePage).toContain("configureZitadel");
    expect(profilePage).toContain("project={project}");
    expect(profilePage).toContain('post-sign-out-url="/login"');
    const middleware = await readFile(join(cwd, "middleware.ts"), "utf8");
    expect(middleware).toContain("zitadel-cli: managed-file v1");
    expect(middleware).toContain("nextgenMiddleware");
    expect(middleware).toContain("export function middleware(");
    expect(middleware).toContain('protectedRoutes: ["/profile"]');
    expect(middleware).toContain('"/__nextgen/:path*"');
    expect(middleware).toContain("process.env.ZITADEL_URL");
    const envLocal = await readFile(join(cwd, ".env.local"), "utf8");
    expect(envLocal).toContain("ZITADEL_ENVIRONMENT=development");
    expect(envLocal).toContain("ZITADEL_URL=");
    expect(envLocal).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(envLocal).toContain("NEXT_PUBLIC_ZITADEL_PROJECT_ID=");
    expect(envLocal).not.toContain("ZITADEL_PROJECT_SECRET");
    expect(envLocal).not.toContain("ZITADEL_PREVIEW_SECRET");
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);
    const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["@zitadel/sdk-next"]).toBe("alpha");

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
    const planJson = parseJson(plan.stdout) as { status: string; data: { total: number } };
    expect(planJson.status).toBe("ok");
    expect(typeof planJson.data.total).toBe("number");
    expect(await readFile(join(cwd, ".zitadel/state.json"), "utf8")).toBe(stateBeforePlan);

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(0);
    const applyJson = parseJson(apply.stdout) as { status: string; data: { synced: boolean } };
    expect(applyJson.status).toBe("ok");
    expect(applyJson.data.synced).toBe(true);
  });

  it("fails apply clearly for missing env refs", async () => {
    const cwd = await createNextProject();
    await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
    ]);

    const flowWithEnvRef = {
      // Spec: `name` is the slug-pattern stable identifier; required fields
      // are [name, user_schema, purposes, steps]. `purposes` is a map
      // from purpose name to entry-point step name.
      name: "default",
      user_schema: "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          fields: [],
          actions: {},
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
    await writeFile(join(cwd, ".zitadel/flows/default.json"), JSON.stringify(flowWithEnvRef, null, 2));

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(3);
    const applyJson = parseJson(apply.stdout) as { code: string; message: string };
    expect(applyJson.code).toBe("E_VALIDATION");
    expect(applyJson.message).toContain("Missing environment variables");

    const applyWithEnv = await cli(["apply", "--cwd", cwd, "--json"], { MY_CAPTCHA_SECRET: "hunter2" });
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
          next: "^15.0.0",
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
