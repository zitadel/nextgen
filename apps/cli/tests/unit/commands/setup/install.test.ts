import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installDependenciesForSetup,
  type SetupInstallInput,
} from "../../../../src/commands/setup/install";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempProject(packageJson: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-setup-install-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo", ...packageJson }));
  return dir;
}

function input(overrides: Partial<SetupInstallInput> = {}): SetupInstallInput {
  return {
    cliVersion: "1.2.3",
    cwd: "",
    depsAdded: ["@zitadel/sdk-next"],
    dryRun: false,
    env: {},
    issuer: "http://localhost:3000",
    json: true,
    scaffoldedFramework: false,
    skipInstall: false,
    ...overrides,
  };
}

const planCommand = "npx @zitadel/cli@latest plan";

describe("setup dependency installation", () => {
  it("installs when setup added a dependency", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(input({ cwd, run }));

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].display).toBe("npm install");
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      cwd,
      redirectStdoutToStderr: true,
    });
    expect(result.install).toMatchObject({
      status: "completed",
      package_manager: "npm",
      command: "npm install",
    });
    expect(result.nextActions.join("\n")).toContain(
      "Start your project: npm run dev (then open http://localhost:3000/login)",
    );
    expect(result.nextActions.join("\n")).not.toContain(
      "Start your project: npm run dev (then open http://localhost:3000)",
    );
    expect(result.nextActions.join("\n")).toContain("register a user");
    expect(result.nextActions.join("\n")).toContain("log in again");
    expect(result.nextActions.join("\n")).toContain(".zitadel/schemas/");
    expect(result.nextActions.join("\n")).toContain(".zitadel/flows/");
    expect(result.nextActions.join("\n")).toContain(
      `See your changes before they go live: ${planCommand} to preview, then npx @zitadel/cli@latest apply to publish.`,
    );
    expect(result.nextCommands).toEqual(["npm run dev", planCommand]);
  });

  it("stages the human box to the verify mission while the JSON envelope stays complete", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(input({ cwd, run }));

    // The box ends on one breadcrumb instead of the customize/publish pair —
    // those steps only make sense after the first successful login.
    expect(result.boxActions.at(-1)).toBe(
      "Once login works: npx @zitadel/cli@latest status shows your next steps; " +
        "customizing is covered in your README's Zitadel section.",
    );
    expect(result.boxActions.join("\n")).toContain("register a user");
    expect(result.boxActions.join("\n")).not.toContain(".zitadel/schemas/");
    expect(result.boxActions.join("\n")).not.toContain(planCommand);
    // Every box line except the breadcrumb is also in the envelope, which
    // additionally carries the customize/publish pair for agents.
    for (const action of result.boxActions.slice(0, -1)) {
      expect(result.nextActions).toContain(action);
    }
    expect(result.nextActions.join("\n")).toContain(".zitadel/schemas/");
  });

  it("keeps the install step first in the box when installation was skipped", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(input({ cwd, run, skipInstall: true }));

    expect(result.boxActions[0]).toBe("Install dependencies: npm install");
    expect(result.nextActions[0]).toBe("Install dependencies: npm install");
  });

  it("installs after fresh scaffolding even when no Zitadel dependency changed", async () => {
    const cwd = await tempProject({ packageManager: "pnpm@10.33.2" });
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(
      input({ cwd, depsAdded: [], scaffoldedFramework: true, run }),
    );

    expect(run.mock.calls[0]?.[0].display).toBe("pnpm install");
    expect(result.nextCommands).toEqual(["pnpm dev", planCommand]);
  });

  it("skips and recommends install when --skip-install is set", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(input({ cwd, run, skipInstall: true }));

    expect(run).not.toHaveBeenCalled();
    expect(result.install).toMatchObject({ status: "skipped", reason: "skip-install" });
    expect(result.nextCommands).toEqual(["npm install", "npm run dev", planCommand]);
  });

  it("skips and recommends install during dry-run", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(input({ cwd, dryRun: true, run }));

    expect(run).not.toHaveBeenCalled();
    expect(result.install).toMatchObject({ status: "skipped", reason: "dry-run" });
    expect(result.nextCommands).toEqual(["npm install", "npm run dev", planCommand]);
  });

  it("does not install when no dependency changed", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => undefined);

    const result = await installDependenciesForSetup(input({ cwd, depsAdded: [], run }));

    expect(run).not.toHaveBeenCalled();
    expect(result.install).toMatchObject({ status: "not-needed" });
    expect(result.nextCommands).toEqual(["npm run dev", planCommand]);
  });

  it("surfaces install failures with remediation", async () => {
    const cwd = await tempProject();
    const run = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { code: 1 });
    });

    await expect(installDependenciesForSetup(input({ cwd, run }))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "Dependency install failed: npm install",
      nextCommands: ["npm install"],
    });
  });
});
