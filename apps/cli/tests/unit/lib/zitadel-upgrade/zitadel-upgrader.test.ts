import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { shellCommand } from "@/lib/suggestion";
import { ZitadelUpgrader } from "@/lib/zitadel-upgrade";
import { rejectionOf } from "@tests/helpers/thrown-value";

const REGISTRY = "https://registry.npmjs.org/-/package/@zitadel%2fcli/dist-tags";
const RELEASES = "https://api.github.com/repos/zitadel/nextgen/releases";

const server = setupServer();
let dir: string;

function upgrader(dryRun: boolean): ZitadelUpgrader {
  return new ZitadelUpgrader({
    cliVersion: "1.0.0",
    cwd: dir,
    typedCwd: undefined,
    env: { XDG_CONFIG_HOME: dir },
    json: true,
    noTelemetry: false,
    dryRun,
    signal: new AbortController().signal,
    retry: shellCommand("zitadel upgrade"),
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-upgrader-"));
  server.use(
    http.get(REGISTRY, () => HttpResponse.json({ latest: "2.0.0" })),
    http.get(RELEASES, () => HttpResponse.json([])),
  );
});
afterEach(async () => {
  server.resetHandlers();
  await rm(dir, { recursive: true, force: true });
});

describe("ZitadelUpgrader.plan", () => {
  it("moves the exact pins that are behind the latest release", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@zitadel/sdk-next": "1.0.0" } }),
    );

    const plan = await upgrader(true).plan();

    expect(plan.packages).toEqual([{ name: "@zitadel/sdk-next", from: "1.0.0", to: "2.0.0" }]);
  });

  it("refuses with E_NETWORK when the latest release cannot be looked up", async () => {
    server.use(http.get(REGISTRY, () => HttpResponse.error()));

    const error = await rejectionOf(() => {
      return upgrader(true).plan();
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect((error as ZitadelError).code).toBe("E_NETWORK");
  });
});

describe("ZitadelUpgrader.apply", () => {
  it("installs nothing on a dry run and says what would move", async () => {
    const manifest = JSON.stringify({ dependencies: { "@zitadel/sdk-next": "1.0.0" } });
    await writeFile(join(dir, "package.json"), manifest);
    const upgrade = upgrader(true);

    const result = await upgrade.apply(await upgrade.plan());

    expect([result.installed, await readFile(join(dir, "package.json"), "utf8")]).toEqual([
      false,
      manifest,
    ]);
    expect(result.report.rows().join("\n")).toContain("@zitadel/sdk-next 1.0.0 → 2.0.0");
  });

  it("installs nothing when no package is behind, though this CLI is", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@zitadel/sdk-next": "2.0.0" } }),
    );
    const upgrade = upgrader(false);
    const plan = await upgrade.plan();

    const result = await upgrade.apply(plan);

    expect([plan.upToDate, result.installed, result.report.refresh]).toEqual([
      false,
      false,
      "skipped",
    ]);
  });
});

describe("ZitadelUpgrader.apply when the install fails", () => {
  it("refuses with E_VALIDATION, naming the cause and offering the install, then the upgrade", async () => {
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

    expect(error).toBeInstanceOf(ZitadelError);
    const refusal = error as ZitadelError;
    expect([
      refusal.code,
      refusal.hint?.endsWith("Nothing else changed; fix that and rerun."),
    ]).toEqual(["E_VALIDATION", true]);
    expect(refusal.nextCommands?.[0]).toContain("@zitadel/sdk-next@2.0.0");
    expect(refusal.nextCommands?.[1]).toBe("zitadel upgrade");
  });
});
