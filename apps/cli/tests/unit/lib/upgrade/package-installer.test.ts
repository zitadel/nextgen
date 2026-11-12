import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { breakingChanges } from "@/lib/release-notes";
import {
  InstallError,
  PackageInstaller,
  Release,
  ScopedDependencies,
  UpgradePlan,
} from "@/lib/upgrade";
import { rejectionOf } from "@tests/helpers/thrown-value";

const server = setupServer(
  http.get("https://api.github.com/repos/zitadel/nextgen/releases", () => {
    return HttpResponse.json([]);
  }),
);
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
    dependencies: await ScopedDependencies.read(dir, "@zitadel/"),
    changes: { breakingChanges },
  });
}

function installerIn(cwd: string): PackageInstaller {
  return new PackageInstaller({ cwd, typedCwd: undefined, redirectStdoutToStderr: true });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
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

    expect(install?.display).toContain("@zitadel/api@2.0.0");
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
    expect((error as InstallError).command).toBe(install.display);
    expect((error as InstallError).cause).toBeDefined();
  });
});
