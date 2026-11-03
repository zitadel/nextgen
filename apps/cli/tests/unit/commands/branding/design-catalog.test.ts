import { describe, expect, it } from "vitest";

import {
  DESIGN_CATALOG,
  isBrandingDesign,
  isRetiredDesign,
} from "../../../../src/commands/branding/design-catalog";

describe("design catalog", () => {
  it("lists the shipped designs", () => {
    expect(DESIGN_CATALOG).toBe("centered, minimal");
  });

  it("knows a shipped design from a retired one", () => {
    expect(isBrandingDesign("centered")).toBe(true);
    expect(isBrandingDesign("hero")).toBe(false);
    expect(isRetiredDesign("hero")).toBe(true);
    expect(isRetiredDesign("centered")).toBe(false);
  });
});
