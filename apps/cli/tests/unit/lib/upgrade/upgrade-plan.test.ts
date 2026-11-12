import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { breakingChanges } from "@/lib/release-notes";
import { Release, ScopedDependencies, UpgradePlan } from "@/lib/upgrade";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELEASES = "https://api.github.com/repos/zitadel/nextgen/releases";

const server = setupServer(
  http.get(RELEASES, () => {
    return HttpResponse.json([{ tag_name: "v2.0.0", body: "**Breaking:** it broke" }]);
  }),
);
const created: string[] = [];

async function plan(cliVersion: string, latest: string, dependencies: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-upgrade-plan-"));
  created.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
  return UpgradePlan.create({
    cliVersion,
    latest: new Release(latest),
    dependencies: await ScopedDependencies.read(dir, "@zitadel/"),
    changes: { breakingChanges },
  });
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

describe("UpgradePlan.create", () => {
  it("moves the pins that are behind the release", async () => {
    const result = await plan("2.0.0", "2.0.0", {
      "@zitadel/api": "1.0.0",
      "@zitadel/sdk": "2.0.0",
    });

    expect(result.packages).toEqual([{ name: "@zitadel/api", from: "1.0.0", to: "2.0.0" }]);
  });

  it("never moves a CLI that is ahead of the release back", async () => {
    const result = await plan("3.0.0-alpha.1", "2.0.0", {});

    expect(result.target).toBe("3.0.0-alpha.1");
  });

  it("leaves a range alone and names it", async () => {
    const result = await plan("2.0.0", "2.0.0", { "@zitadel/api": "^1.0.0" });

    expect(result.leftAlone.map((dependency) => dependency.name)).toEqual(["@zitadel/api"]);
  });

  it("is up to date with nothing behind and a current CLI", async () => {
    const result = await plan("2.0.0", "2.0.0", { "@zitadel/api": "2.0.0" });

    expect(result.upToDate).toBe(true);
  });

  it("reads the breaking changes only when something moves", async () => {
    const behind = await plan("1.0.0", "2.0.0", {});
    const current = await plan("2.0.0", "2.0.0", {});

    expect([behind.breaking.length, current.breaking.length]).toEqual([1, 0]);
  });

  it("hands the package manager name@version specs", async () => {
    const result = await plan("2.0.0", "2.0.0", { "@zitadel/api": "1.0.0" });

    expect(result.specs).toEqual(["@zitadel/api@2.0.0"]);
  });
});
