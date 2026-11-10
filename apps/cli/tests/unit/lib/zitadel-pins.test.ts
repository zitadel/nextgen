import { describe, expect } from "vitest";

import { exactZitadelPins, floatingZitadelSpecs } from "@/lib/zitadel-pins";
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

describe("exactZitadelPins", () => {
  it("is undefined without a package.json", async ({ dir }) => {
    const pins = await exactZitadelPins(dir);

    expect(pins).toBeUndefined();
  });

  it("refuses a package.json that is not valid JSON", async ({ dir }) => {
    await write(dir, { "package.json": "{ not json" });

    const error = await rejectionOf(() => {
      return exactZitadelPins(dir);
    });

    expect(error).toBeInstanceOf(SyntaxError);
  });

  it("lists only the exact pins of @zitadel packages", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const pins = await exactZitadelPins(dir);

    expect(pins).toEqual([
      ["@zitadel/sdk-next", "1.2.3"],
      ["@zitadel/testing", "2.0.0"],
    ]);
  });
});

describe("floatingZitadelSpecs", () => {
  it("lists the @zitadel dependencies that are not exact pins", async ({ dir }) => {
    await write(dir, { "package.json": MIXED });

    const specs = await floatingZitadelSpecs(dir);

    expect(specs).toEqual([["@zitadel/api", "^1.2.3"]]);
  });
});
