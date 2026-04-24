import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

describe("Next setup integration", () => {
  it("sets up, verifies, edits schema, applies, and preserves idempotency", async () => {
    const cwd = await createNextProject();

    const setup = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--mock",
      "--skip-deploy-platform",
    ]);
    expect(setup.exitCode).toBe(0);
    const setupJson = parseJson(setup.stdout) as { status: string; data: { project: { lifecycle: string }; apply?: unknown } };
    expect(setupJson.status).toBe("ok");
    expect(setupJson.data.project.lifecycle).toBe("pre-claim");
    expect(setupJson.data.apply).toBeDefined();

    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain("\"project\"");
    expect(await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8")).toContain("\"x-unique\": \"project\"");
    const flowRaw = await readFile(join(cwd, ".zitadel/flows/default.json"), "utf8");
    expect(flowRaw).toContain("\"template_name\": \"default\"");
    expect(flowRaw).toContain("\"text_key\": \"identifier.field.email\"");
    const localeRaw = await readFile(join(cwd, ".zitadel/locales/en.json"), "utf8");
    expect(localeRaw).toContain("\"identifier.title\": \"Sign in\"");
    expect(await readFile(join(cwd, "app/login/page.tsx"), "utf8")).toContain("zitadel-cli: managed-file v1");
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toContain("ZITADEL_ENVIRONMENT=development");
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);

    const doctor = await runCliForTest(["doctor", "--cwd", cwd, "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect((parseJson(doctor.stdout) as { status: string }).status).toBe("ok");

    const noArg = await runCliForTest(["--cwd", cwd, "--json"]);
    expect(noArg.exitCode).toBe(0);
    const status = parseJson(noArg.stdout) as { status: string; data: { project: { lifecycle: string }; next_actions: string[] } };
    expect(status.status).toBe("ok");
    expect(status.data.project.lifecycle).toBe("pre-claim");
    expect(status.data.next_actions.join(" ")).toContain("apply");

    const rerun = await runCliForTest(["setup", "--cwd", cwd, "--json"]);
    expect(rerun.exitCode).toBe(0);
    expect((parseJson(rerun.stdout) as { status: string }).status).toBe("skipped");

    const stateBeforePlan = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    const plan = await runCliForTest(["plan", "--cwd", cwd, "--json", "--mock"]);
    expect(plan.exitCode).toBe(0);
    const planJson = parseJson(plan.stdout) as { status: string; data: { dry_run: boolean; uploaded: boolean } };
    expect(planJson.status).toBe("ok");
    expect(planJson.data.dry_run).toBe(true);
    expect(planJson.data.uploaded).toBe(false);
    expect(await readFile(join(cwd, ".zitadel/state.json"), "utf8")).toBe(stateBeforePlan);

    const addSchema = await runCliForTest([
      "add",
      "schema",
      "--cwd",
      cwd,
      "--json",
      "--add-field",
      "phone:string:format=phone,x-mfa=sms",
    ]);
    expect(addSchema.exitCode).toBe(0);
    expect(await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8")).toContain("\"phone\"");

    const apply = await runCliForTest(["apply", "--cwd", cwd, "--json", "--mock"]);
    expect(apply.exitCode).toBe(0);
    const applyJson = parseJson(apply.stdout) as { status: string; data: { state_recorded: boolean } };
    expect(applyJson.status).toBe("ok");
    expect(applyJson.data.state_recorded).toBe(true);

    const production = await runCliForTest(["apply", "--cwd", cwd, "--json", "--mock", "--environment", "production"]);
    expect(production.exitCode).toBe(3);
    expect((parseJson(production.stdout) as { code: string }).code).toBe("E_CLAIM_REQUIRED");

    const claim = await runCliForTest(["claim", "--cwd", cwd, "--json", "--mock"]);
    expect(claim.exitCode).toBe(0);
    const claimJson = parseJson(claim.stdout) as { status: string; data: { handoff: string; claim_url: string } };
    expect(claimJson.status).toBe("ok");
    expect(claimJson.data.handoff).toBe("human");
    expect(claimJson.data.claim_url).toContain("claim");
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
