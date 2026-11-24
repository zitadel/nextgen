import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { Dependencies } from "@/lib/upgrade/dependencies";
import { UpgradePlan } from "@/lib/upgrade/plan";
import { Release } from "@/lib/upgrade/release";

/**
 * Plans an upgrade for a project that pins the dependencies.
 *
 * @param dir - The project's directory.
 * @param cliVersion - The version of the CLI that is running.
 * @param latest - The latest release.
 * @param dependencies - The dependencies the project's package.json names.
 * @returns The plan.
 */
async function plan(
  dir: string,
  cliVersion: string,
  latest: string,
  dependencies: Record<string, string>,
) {
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
  return UpgradePlan.create({
    cliVersion,
    latest: new Release(latest),
    dependencies: await Dependencies.read(dir, "@zitadel/"),
  });
}

describe("UpgradePlan.create", () => {
  it("moves the pins that are behind the release", async ({ dir }) => {
    const result = await plan(dir, "2.0.0", "2.0.0", {
      "@zitadel/api": "1.0.0",
      "@zitadel/sdk": "2.0.0",
    });

    expect(result.packages).toEqual([{ name: "@zitadel/api", from: "1.0.0", to: "2.0.0" }]);
  });

  it("never moves a CLI that is ahead of the release back", async ({ dir }) => {
    const result = await plan(dir, "3.0.0-alpha.1", "2.0.0", {});

    expect(result.target).toBe("3.0.0-alpha.1");
  });

  it("is up to date, and moves nothing, for a development build whose version is not semver", async ({
    dir,
  }) => {
    const result = await plan(dir, "dev", "2.0.0", { "@zitadel/api": "1.0.0" });

    expect([result.upToDate, result.packages, result.target]).toEqual([true, [], "dev"]);
  });

  it("leaves a range alone and names it", async ({ dir }) => {
    const result = await plan(dir, "2.0.0", "2.0.0", { "@zitadel/api": "^1.0.0" });

    expect(result.leftAlone.map((dependency) => dependency.name)).toEqual(["@zitadel/api"]);
  });

  it("is up to date with nothing behind and a current CLI", async ({ dir }) => {
    const result = await plan(dir, "2.0.0", "2.0.0", { "@zitadel/api": "2.0.0" });

    expect(result.upToDate).toBe(true);
  });

  it("starts from the oldest of the CLI and the pins that move", async ({ dir }) => {
    const result = await plan(dir, "2.0.0", "2.0.0", { "@zitadel/api": "1.0.0" });

    expect(result.oldest).toBe("1.0.0");
  });

  it("names a starting version, without throwing, when the CLI's version is not semver", async ({
    dir,
  }) => {
    const result = await plan(dir, "dev", "2.0.0", { "@zitadel/api": "1.0.0" });

    expect(result.oldest).toBe("0.0.0");
  });

  it("hands the package manager name@version specs", async ({ dir }) => {
    const result = await plan(dir, "2.0.0", "2.0.0", { "@zitadel/api": "1.0.0" });

    expect(result.specs).toEqual(["@zitadel/api@2.0.0"]);
  });
});
