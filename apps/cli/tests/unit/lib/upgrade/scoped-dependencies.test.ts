import { describe, expect } from "vitest";

import { ScopedDependencies, ZITADEL } from "@/lib/upgrade";
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

function summary(dependencies: ScopedDependencies | undefined, kind: "exact" | "floating") {
  return dependencies?.[kind]().map((dependency) => {
    return [dependency.name, dependency.specifier];
  });
}

describe("ScopedDependencies.read", () => {
  it("is undefined without a package.json", async ({ dir }) => {
    await expect(ScopedDependencies.read(dir, ZITADEL.scope)).resolves.toBeUndefined();
  });

  it("refuses a package.json that is not valid JSON", async ({ dir }) => {
    await write(dir, { "package.json": "{ not json" });

    const error = await rejectionOf(() => {
      return ScopedDependencies.read(dir, ZITADEL.scope);
    });

    expect(error).toBeInstanceOf(SyntaxError);
  });

  it("keeps only the packages in the scope it is given", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const dependencies = await ScopedDependencies.read(dir, "@other/");

    expect(summary(dependencies, "exact")).toEqual([]);
  });
});

describe("ScopedDependencies.exact", () => {
  it("lists only the exact pins of the scope", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const dependencies = await ScopedDependencies.read(dir, ZITADEL.scope);

    expect(summary(dependencies, "exact")).toEqual([
      ["@zitadel/sdk-next", "1.2.3"],
      ["@zitadel/testing", "2.0.0"],
    ]);
  });
});

describe("ScopedDependencies.floating", () => {
  it("lists the dependencies of the scope that are not exact pins", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const dependencies = await ScopedDependencies.read(dir, ZITADEL.scope);

    expect(summary(dependencies, "floating")).toEqual([["@zitadel/api", "^1.2.3"]]);
  });
});
