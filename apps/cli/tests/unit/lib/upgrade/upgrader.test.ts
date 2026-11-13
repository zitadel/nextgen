import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { describe, expect } from "vitest";

import { Cache } from "@/lib/upgrade/cache";
import { ReleaseChannel } from "@/lib/upgrade/channel";
import { InstallError, ReleaseLookupError } from "@/lib/upgrade/errors";
import { PackageInstaller } from "@/lib/upgrade/installer";
import { Upgrader } from "@/lib/upgrade/upgrader";
import { test } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

/** `it` with an upgrader whose registry answers 2.0.0, in a project directory of its own. */
const it = test.extend<{ upgrader: (dryRun: boolean) => Upgrader }>({
  upgrader: ({ dir, server }, use) => {
    server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));
    return use((dryRun) => {
      return new Upgrader({
        cliVersion: "1.0.0",
        cwd: dir,
        scope: "@zitadel/",
        dryRun,
        channel: new ReleaseChannel({
          packageName: "@zitadel/cli",
          distTag: "latest",
          registry: "https://registry.npmjs.org",
          cache: new Cache(join(dir, "update-check.json")),
        }),
        installer: new PackageInstaller({
          cwd: dir,
          typedCwd: undefined,
          redirectStdoutToStderr: true,
        }),
      });
    });
  },
});

describe("Upgrader.plan", () => {
  it("moves the exact pins that are behind the latest release", async ({ upgrader, dir }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@zitadel/sdk-next": "1.0.0" } }),
    );

    const plan = await upgrader(true).plan();

    expect(plan.packages).toEqual([{ name: "@zitadel/sdk-next", from: "1.0.0", to: "2.0.0" }]);
  });

  it("fails with a ReleaseLookupError when the latest release cannot be looked up", async ({
    upgrader,
    server,
  }) => {
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    const error = await rejectionOf(() => {
      return upgrader(true).plan();
    });

    expect(error).toBeInstanceOf(ReleaseLookupError);
  });
});

describe("Upgrader.apply", () => {
  it("installs nothing on a dry run and says what would move", async ({ upgrader, dir }) => {
    const manifest = JSON.stringify({ dependencies: { "@zitadel/sdk-next": "1.0.0" } });
    await writeFile(join(dir, "package.json"), manifest);
    const upgrade = upgrader(true);

    const result = await upgrade.apply(await upgrade.plan());

    expect([result.installed, await readFile(join(dir, "package.json"), "utf8")]).toEqual([
      false,
      manifest,
    ]);
    expect(result.installCommand).toContain("@zitadel/sdk-next@2.0.0");
  });

  it("installs nothing when no package is behind, though this CLI is", async ({
    upgrader,
    dir,
  }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@zitadel/sdk-next": "2.0.0" } }),
    );
    const upgrade = upgrader(false);
    const plan = await upgrade.plan();

    const result = await upgrade.apply(plan);

    expect([plan.upToDate, result.installed, result.installCommand]).toEqual([
      false,
      false,
      undefined,
    ]);
  });
});

describe("Upgrader.apply when the install fails", () => {
  it("fails with an InstallError that names the install and keeps the cause", async ({
    upgrader,
    dir,
  }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@zitadel/sdk-next": "1.0.0" } }),
    );
    const upgrade = upgrader(false);
    const plan = await upgrade.plan();
    await rm(dir, { recursive: true, force: true });

    const error = await rejectionOf(() => {
      return upgrade.apply(plan);
    });

    expect(error).toBeInstanceOf(InstallError);
    expect(error).toMatchObject({
      command: { display: expect.stringContaining("@zitadel/sdk-next@2.0.0") },
      cause: expect.anything(),
    });
  });
});
