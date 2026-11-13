import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Cache } from "@/lib/upgrade/cache";
import { ReleaseChannel } from "@/lib/upgrade/channel";
import { InstallError, ReleaseLookupError } from "@/lib/upgrade/errors";
import { PackageInstaller } from "@/lib/upgrade/installer";
import { Upgrader } from "@/lib/upgrade/upgrader";
import { rejectionOf } from "@tests/helpers/thrown-value";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";

const server = setupServer();
let dir: string;

function upgrader(dryRun: boolean): Upgrader {
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
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-upgrader-"));
  server.use(http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })));
});
afterEach(async () => {
  server.resetHandlers();
  await rm(dir, { recursive: true, force: true });
});

describe("Upgrader.plan", () => {
  it("moves the exact pins that are behind the latest release", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@zitadel/sdk-next": "1.0.0" } }),
    );

    const plan = await upgrader(true).plan();

    expect(plan.packages).toEqual([{ name: "@zitadel/sdk-next", from: "1.0.0", to: "2.0.0" }]);
  });

  it("fails with a ReleaseLookupError when the latest release cannot be looked up", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    const error = await rejectionOf(() => {
      return upgrader(true).plan();
    });

    expect(error).toBeInstanceOf(ReleaseLookupError);
  });
});

describe("Upgrader.apply", () => {
  it("installs nothing on a dry run and says what would move", async () => {
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

  it("installs nothing when no package is behind, though this CLI is", async () => {
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
  it("fails with an InstallError that names the install and keeps the cause", async () => {
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
    expect((error as InstallError).command.display).toContain("@zitadel/sdk-next@2.0.0");
    expect((error as InstallError).cause).toBeDefined();
  });
});
