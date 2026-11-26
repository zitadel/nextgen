import { posix } from "node:path";

import { describe, expect, it } from "vitest";

import { importsUnder } from "@tests/helpers/source-imports";

const LAYER = posix.join("lib", "zitadel");

describe("the zitadel library's dependencies", () => {
  it("reach nothing under lib/ outside the library", async () => {
    const reached = (await importsUnder(LAYER))
      .filter((found) => {
        return (
          found.target.startsWith("lib/") &&
          found.target !== LAYER &&
          !found.target.startsWith(`${LAYER}/`) &&
          !(found.target === "lib/errors" && found.file === posix.join(LAYER, "errors.ts")) &&
          found.target !== "lib/fs" &&
          !(
            found.target === "lib/errno" &&
            found.file === posix.join(LAYER, "storage", "backend", "store.ts")
          )
        );
      })
      .map((found) => {
        return `${found.file} imports ${found.specifier}`;
      });

    expect(reached).toEqual([]);
  });
});
