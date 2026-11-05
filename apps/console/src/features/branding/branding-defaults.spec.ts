import { describe, expect, it } from "vitest";

import { MAINTAINED_FONT_FAMILY, maintainedPalette } from "./branding-defaults";

describe("maintainedPalette", () => {
  it("reads each side's own values", () => {
    expect(maintainedPalette("dark").background).toBe("#050505");
    expect(maintainedPalette("light").background).toBe("#fafafa");
  });

  it("inherits what the light side does not redefine", () => {
    expect(maintainedPalette("light").success).toBe(maintainedPalette("dark").success);
  });

  it("shows link as the text colour it resolves to", () => {
    expect(maintainedPalette("dark").link).toBe(maintainedPalette("dark").text);
  });

  it("has a value for every key", () => {
    for (const side of ["light", "dark"] as const) {
      expect(Object.values(maintainedPalette(side)).every((v) => v !== "")).toBe(true);
    }
  });
});

describe("MAINTAINED_FONT_FAMILY", () => {
  it("is the first family of the sans stack", () => {
    expect(MAINTAINED_FONT_FAMILY).toBe("Arimo");
  });
});
