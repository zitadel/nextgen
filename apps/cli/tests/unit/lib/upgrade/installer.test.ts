import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { PM } from "@/lib/pm";
import { Dependencies } from "@/lib/upgrade/dependencies";
import { InstallError } from "@/lib/upgrade/errors";
import { PackageInstaller, type PlannedInstall } from "@/lib/upgrade/installer";
import { UpgradePlan } from "@/lib/upgrade/plan";
import { Release } from "@/lib/upgrade/release";
import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * Writes a `package.json` declaring the given dependencies.
 *
 * @param dir - The directory to write it in.
 * @param dependencies - The dependencies it declares.
 * @returns Once the file is written.
 */
async function project(dir: string, dependencies: Record<string, string>): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
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

describe("PackageInstaller.plan", () => {
  it("installs the packages that moved at exact versions", async ({ dir }) => {
    await project(dir, { "@zitadel/api": "1.0.0" });

    const install = await installerIn(dir).plan(await aPlan(dir));

    expect(install?.shown.display).toContain("@zitadel/api@2.0.0");
  });

  it("has nothing to install when no package moves", async ({ dir }) => {
    await project(dir, { "@zitadel/api": "2.0.0" });

    await expect(installerIn(dir).plan(await aPlan(dir))).resolves.toBeUndefined();
  });
});

describe("PackageInstaller.install", () => {
  it("fails with an InstallError that names the install and keeps the cause", async ({ dir }) => {
    await project(dir, { "@zitadel/api": "1.0.0" });
    const install = await installerIn(dir).plan(await aPlan(dir));
    if (install === undefined) {
      throw new Error("the plan should have an install");
    }

    const error = await rejectionOf(() => {
      return installerIn(join(dir, "missing")).install(install);
    });

    expect(error).toBeInstanceOf(InstallError);
    expect(error).toMatchObject({ command: install.shown, cause: expect.anything() });
  });

  it("wraps a package manager that runs and exits non-zero, with the exit as the cause", async ({
    dir,
  }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@zitadel/api": "1.0.0" },
        scripts: { exits: 'node -e "process.exit(3)"' },
      }),
    );
    const run = PM.named("npm").script("exits");
    const install: PlannedInstall = { run, shown: run };

    const error = await rejectionOf(() => {
      return installerIn(dir).install(install);
    });

    expect(error).toBeInstanceOf(InstallError);
    expect(error).toMatchObject({ cause: { code: 3 } });
  });
});
