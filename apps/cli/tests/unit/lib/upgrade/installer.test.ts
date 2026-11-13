import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Dependencies } from "@/lib/upgrade/dependencies";
import { InstallError } from "@/lib/upgrade/errors";
import { PackageInstaller, type PlannedInstall } from "@/lib/upgrade/installer";
import { UpgradePlan } from "@/lib/upgrade/plan";
import { Release } from "@/lib/upgrade/release";
import { rejectionOf } from "@tests/helpers/thrown-value";

const created: string[] = [];

async function project(dependencies: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-package-installer-"));
  created.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
  return dir;
}

async function aPlan(dir: string): Promise<UpgradePlan> {
  return UpgradePlan.create({
    cliVersion: "2.0.0",
    latest: new Release("2.0.0"),
    dependencies: await Dependencies.read(dir, "@zitadel/"),
  });
}

function installerIn(cwd: string): PackageInstaller {
  return new PackageInstaller({ cwd, typedCwd: undefined, redirectStdoutToStderr: true });
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => {
      return rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("PackageInstaller.plan", () => {
  it("installs the packages that moved at exact versions", async () => {
    const dir = await project({ "@zitadel/api": "1.0.0" });

    const install = await installerIn(dir).plan(await aPlan(dir));

    expect(install?.shown.display).toContain("@zitadel/api@2.0.0");
  });

  it("has nothing to install when no package moves", async () => {
    const dir = await project({ "@zitadel/api": "2.0.0" });

    await expect(installerIn(dir).plan(await aPlan(dir))).resolves.toBeUndefined();
  });
});

describe("PackageInstaller.install", () => {
  it("fails with an InstallError that names the install and keeps the cause", async () => {
    const dir = await project({ "@zitadel/api": "1.0.0" });
    const install = await installerIn(dir).plan(await aPlan(dir));
    if (install === undefined) {
      throw new Error("the plan should have an install");
    }

    const error = await rejectionOf(() => {
      return installerIn(join(dir, "missing")).install(install);
    });

    expect(error).toBeInstanceOf(InstallError);
    expect((error as InstallError).command).toBe(install.shown);
    expect((error as InstallError).cause).toBeDefined();
  });

  it("wraps a package manager that runs and exits non-zero, with the exit as the cause", async () => {
    const dir = await project({ "@zitadel/api": "1.0.0" });
    const run: PlannedInstall["run"] = {
      command: process.execPath as PlannedInstall["run"]["command"],
      verb: "add",
      operands: [],
      args: ["-e", "process.exit(3)"],
      display: "node -e process.exit(3)",
    };
    const install: PlannedInstall = { run, shown: run };

    const error = await rejectionOf(() => {
      return installerIn(dir).install(install);
    });

    expect(error).toBeInstanceOf(InstallError);
    expect(((error as InstallError).cause as { code?: number }).code).toBe(3);
  });
});
