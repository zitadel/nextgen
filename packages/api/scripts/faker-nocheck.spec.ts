import { describe, expect, it } from "vitest";

import { NOCHECK, withNoCheck } from "./faker-nocheck.ts";

describe("withNoCheck", () => {
  it("puts the directive first", () => {
    expect(withNoCheck("export const a = 1;\n")).toBe(`${NOCHECK}\nexport const a = 1;\n`);
  });

  it("does not add it twice", () => {
    expect(withNoCheck(withNoCheck("export const a = 1;\n"))).toBe(
      `${NOCHECK}\nexport const a = 1;\n`,
    );
  });
});
