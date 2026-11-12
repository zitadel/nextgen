import { describe, expect, it as plain } from "vitest";

import { Dependencies, Dependency } from "@/lib/upgrade/dependencies";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * A `package.json` mixing exact pins, a range and a foreign package.
 */
const MIXED = JSON.stringify({
  dependencies: { "@zitadel/sdk-next": "1.2.3", "@zitadel/api": "^1.2.3", react: "19.0.0" },
  devDependencies: { "@zitadel/testing": " 2.0.0 " },
});

function summary(dependencies: Dependencies | undefined, kind: "exact" | "floating") {
  return dependencies?.[kind]().map((dependency) => {
    return [dependency.name, dependency.specifier];
  });
}

describe("Dependencies.read", () => {
  it("is undefined without a package.json", async ({ dir }) => {
    await expect(Dependencies.read(dir, "@zitadel/")).resolves.toBeUndefined();
  });

  it("refuses a package.json that is not valid JSON", async ({ dir }) => {
    await write(dir, { "package.json": "{ not json" });

    const error = await rejectionOf(() => {
      return Dependencies.read(dir, "@zitadel/");
    });

    expect(error).toBeInstanceOf(SyntaxError);
  });

  it("ignores a dependency whose value is not a string", async ({ dir }) => {
    await write(dir, {
      "package.json": JSON.stringify({
        dependencies: { "@zitadel/sdk": 1, "@zitadel/api": "1.0.0" },
      }),
    });

    const dependencies = await Dependencies.read(dir, "@zitadel/");

    expect(summary(dependencies, "exact")).toEqual([["@zitadel/api", "1.0.0"]]);
  });

  it("keeps only the packages in the scope it is given", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const dependencies = await Dependencies.read(dir, "@other/");

    expect(summary(dependencies, "exact")).toEqual([]);
  });
});

describe("Dependencies.exact", () => {
  it("lists only the exact pins of the scope", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const dependencies = await Dependencies.read(dir, "@zitadel/");

    expect(summary(dependencies, "exact")).toEqual([
      ["@zitadel/sdk-next", "1.2.3"],
      ["@zitadel/testing", "2.0.0"],
    ]);
  });
});

describe("Dependencies.floating", () => {
  it("lists the dependencies of the scope that are not exact pins", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const dependencies = await Dependencies.read(dir, "@zitadel/");

    expect(summary(dependencies, "floating")).toEqual([["@zitadel/api", "^1.2.3"]]);
  });
});

describe("Dependency", () => {
  plain.each([
    ["1.2.3", true],
    ["^1.2.3", false],
    ["latest", false],
    ["workspace:*", false],
  ])("%s is exact: %s", (specifier, exact) => {
    expect(new Dependency("@zitadel/api", specifier).isExact).toBe(exact);
  });

  plain.each([
    ["1.0.0", "2.0.0", true, false],
    ["2.0.0", "2.0.0", false, false],
    ["3.0.0", "2.0.0", false, true],
    ["^1.0.0", "2.0.0", false, false],
    ["1.0.0", "dev", false, false],
  ])("%s against %s: behind %s, ahead %s", (specifier, version, behind, ahead) => {
    const dependency = new Dependency("@zitadel/api", specifier);

    expect([dependency.isBehind(version), dependency.isAhead(version)]).toEqual([behind, ahead]);
  });
});
