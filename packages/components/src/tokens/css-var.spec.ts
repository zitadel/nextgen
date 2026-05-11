import { describe, expect, it } from "vitest";

import { cssVar, cssVarRef, type DesignToken } from "./css-var.js";

const sample: DesignToken = { name: "--zl-color-primary", default: "#4A90D9" };

describe("cssVar", () => {
  it("renders a var() reference with the fallback default", () => {
    expect(cssVar(sample)).toBe("var(--zl-color-primary, #4A90D9)");
  });

  it("renders a bare var() reference without a fallback", () => {
    expect(cssVarRef(sample)).toBe("var(--zl-color-primary)");
  });
});
