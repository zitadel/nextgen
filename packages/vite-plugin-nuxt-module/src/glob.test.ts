import { describe, expect, it } from "vitest";

import { matchesAnyGlob } from "./glob.ts";

describe("matchesAnyGlob", () => {
  it.each([
    ["a.spec.ts", true],
    ["deep/dir/a.test.tsx", true],
    ["__tests__/c.ts", true],
    ["deep/__tests__/c.ts", true],
    [".hidden.test.ts", true],
    ["plain.ts", false],
    ["tests.ts", false],
  ])("matches %s against the test globs: %s", (path, expected) => {
    expect(matchesAnyGlob(path, ["**/*.spec.*", "**/*.test.*", "**/__tests__/**"])).toBe(expected);
  });

  it("matches nothing against no globs", () => {
    expect(matchesAnyGlob("a.ts", [])).toBe(false);
  });
});
