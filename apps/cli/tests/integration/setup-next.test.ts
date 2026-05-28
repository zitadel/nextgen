import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel-nextgen/api-mock/platform";
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
  return runCliForTest(["--server", MOCK_SERVER_URL, ...args], env);
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
    const setupJson = parseJson(setup.stdout) as {
      status: string;
      data: { apply?: unknown };
    };
    expect(setupJson.status).toBe("ok");
    expect(setupJson.data.apply).toMatchObject({ synced: true });

    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"project"');
    expect(await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8")).toContain(
      '"x-unique": "project"',
    );
    const flowRaw = await readFile(join(cwd, ".zitadel/flows/default.json"), "utf8");
    // Spec: `name` is the slug-pattern stable identifier; `template_name`
    // was a non-spec field the CLI used to emit.
    expect(flowRaw).toContain('"name": "default"');
    expect(flowRaw).toContain('"user_schema":');
    expect(flowRaw).toContain('"text_key": "identifier.field.email"');
    const loginPage = await readFile(join(cwd, "app/login/page.tsx"), "utf8");
    expect(loginPage).toContain("zitadel-cli: managed-file v1");
    expect(loginPage).toContain('"use client"');
    expect(loginPage).toContain('purpose="login"');
    expect(loginPage).toContain("<zitadel-login");
    expect(loginPage).toContain('api-base="/__nextgen"');
    expect(loginPage).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(loginPage).toContain('post-sign-in-url="/profile"');
    const profilePage = await readFile(join(cwd, "app/profile/page.tsx"), "utf8");
    expect(profilePage).toContain("zitadel-cli: managed-file v1");
    expect(profilePage).toContain("<zitadel-logout");
    expect(profilePage).toContain('api-base="/__nextgen"');
    expect(profilePage).toContain('post-sign-out-url="/login"');
    const middleware = await readFile(join(cwd, "middleware.ts"), "utf8");
    expect(middleware).toContain("zitadel-cli: managed-file v1");
    expect(middleware).toContain("nextgenMiddleware");
    expect(middleware).toContain("export function middleware(");
    expect(middleware).toContain('protectedRoutes: ["/profile"]');
    expect(middleware).toContain('"/__nextgen/:path*"');
    expect(middleware).toContain("process.env.NEXTGEN_ISSUER_URL");
    const envLocal = await readFile(join(cwd, ".env.local"), "utf8");
    expect(envLocal).toContain("ZITADEL_ENVIRONMENT=development");
    expect(envLocal).toContain("NEXTGEN_ISSUER_URL=");
    expect(envLocal).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(envLocal).toContain("NEXT_PUBLIC_ZITADEL_PROJECT_ID=");
    expect(envLocal).not.toContain("ZITADEL_PROJECT_SECRET");
    expect(envLocal).not.toContain("ZITADEL_PREVIEW_SECRET");
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);

    const doctor = await cli(["doctor", "--cwd", cwd, "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect((parseJson(doctor.stdout) as { status: string }).status).toBe("ok");

    const noArg = await cli(["--cwd", cwd, "--json"]);
    expect(noArg.exitCode).toBe(0);
    const status = parseJson(noArg.stdout) as {
      status: string;
      data: { next_actions: string[] };
    };
    expect(status.status).toBe("ok");
    expect(status.data.next_actions.join(" ")).toContain("apply");

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
      // are [name, user_schema, purposes, initial_steps, steps].
      name: "default",
      user_schema: "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
      purposes: ["login"],
      initial_steps: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          type: "identifier",
          fields: {},
          actions: {},
          gates: { captcha: { type: "captcha", config: { client_secret_env: "MY_CAPTCHA_SECRET" } } },
          transitions: {},
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
