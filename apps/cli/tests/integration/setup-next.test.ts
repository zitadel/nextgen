import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeMockClaim,
  resetPlatformStore,
  setupPlatformHandlers,
} from "@zitadel-nextgen/api-mock/platform";
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
  it("sets up, verifies, edits schema, applies, and preserves idempotency", async () => {
    const cwd = await createNextProject();

    const setup = await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--skip-deploy-platform",
    ]);
    expect(setup.exitCode).toBe(0);
    const setupJson = parseJson(setup.stdout) as {
      status: string;
      data: { project: { lifecycle: string }; apply?: unknown };
    };
    expect(setupJson.status).toBe("ok");
    expect(setupJson.data.project.lifecycle).toBe("pre-claim");
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
    const localeRaw = await readFile(join(cwd, ".zitadel/locales/en.json"), "utf8");
    expect(localeRaw).toContain('"identifier.title": "Sign in"');
    const loginPage = await readFile(join(cwd, "app/login/page.tsx"), "utf8");
    expect(loginPage).toContain("zitadel-cli: managed-file v1");
    expect(loginPage).toContain("ZitadelFlow");
    expect(loginPage).toContain('purpose="login"');
    expect(loginPage).toContain("process.env.NODE_ENV");
    expect(loginPage).not.toContain("ZitadelAuth");
    const envLocal = await readFile(join(cwd, ".env.local"), "utf8");
    expect(envLocal).toContain("ZITADEL_ENVIRONMENT=development");
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
      data: { project: { lifecycle: string }; next_actions: string[] };
    };
    expect(status.status).toBe("ok");
    expect(status.data.project.lifecycle).toBe("pre-claim");
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

    const addSchema = await cli([
      "add",
      "schema",
      "--cwd",
      cwd,
      "--json",
      "--add-field",
      "phone:string:format=phone,x-mfa=sms",
    ]);
    expect(addSchema.exitCode).toBe(0);
    expect(await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8")).toContain('"phone"');

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(0);
    const applyJson = parseJson(apply.stdout) as { status: string; data: { synced: boolean } };
    expect(applyJson.status).toBe("ok");
    expect(applyJson.data.synced).toBe(true);

    const production = await cli(["apply", "--cwd", cwd, "--json", "--environment", "production"]);
    expect(production.exitCode).toBe(3);
    expect((parseJson(production.stdout) as { code: string }).code).toBe("E_CLAIM_REQUIRED");

    const claim = await cli(["claim", "--cwd", cwd, "--json"]);
    expect(claim.exitCode).toBe(0);
    const claimJson = parseJson(claim.stdout) as {
      status: string;
      data: { handoff: string; claim_url: string; challenge_id: string };
    };
    expect(claimJson.status).toBe("ok");
    expect(claimJson.data.handoff).toBe("human");
    expect(claimJson.data.claim_url).toContain("claim");

    const pendingClaim = await cli([
      "claim",
      "status",
      "--cwd",
      cwd,
      "--json",
      "--challenge-id",
      claimJson.data.challenge_id,
    ]);
    expect(pendingClaim.exitCode).toBe(0);
    expect((parseJson(pendingClaim.stdout) as { data: { status: string } }).data.status).toBe(
      "pending",
    );

    completeMockClaim();

    const completedClaim = await cli([
      "claim",
      "status",
      "--cwd",
      cwd,
      "--json",
      "--challenge-id",
      claimJson.data.challenge_id,
    ]);
    expect(completedClaim.exitCode).toBe(0);
    const completedJson = parseJson(completedClaim.stdout) as {
      data: { status: string; state_refreshed: boolean };
    };
    expect(completedJson.data.status).toBe("claimed");
    expect(completedJson.data.state_refreshed).toBe(true);
    const secret = await readFile(join(cwd, ".zitadel/secret"), "utf8");
    expect(secret).toContain('"claimed_at"');
    expect(secret).toContain('"team_id": "team_mock"');

    const productionAfterClaim = await cli([
      "apply",
      "--cwd",
      cwd,
      "--json",
      "--environment",
      "production",
    ]);
    expect(productionAfterClaim.exitCode).toBe(0);
  });

  it("fails apply clearly for missing env refs", async () => {
    const cwd = await createNextProject();
    await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--skip-deploy-platform",
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

  it("applies successfully when liquid templates are present (templates are not synced)", async () => {
    const cwd = await createNextProject();
    await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--skip-deploy-platform",
    ]);
    await mkdir(join(cwd, ".zitadel/templates"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/templates/bad.liquid"), "<div>{{ value | raw }}</div>\n");

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(0);
    const envelope = parseJson(apply.stdout) as { status: string; data: { synced: boolean } };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.synced).toBe(true);
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
