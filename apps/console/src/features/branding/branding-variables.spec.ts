import { describe, expect, it } from "vitest";

import { brandingVariables } from "./branding-variables";

const REVISION = {
  typography: { font_family: "Inter, sans-serif" },
  shape: { radius: "none" },
  theme: {
    light: { palette: { primary: "#ff0000" } },
    dark: { palette: { primary: "#00ff00" } },
  },
} as const;

describe("brandingVariables", () => {
  it("takes the shared values and the requested side's palette", () => {
    const light = brandingVariables(REVISION, "light");
    expect(light["--zl-primary"]).toBe("#ff0000");
    expect(light["--zl-font-family-sans"]).toBe("Inter, sans-serif");
    expect(light["--zl-radius-md"]).toBe("0");
    expect(brandingVariables(REVISION, "dark")["--zl-primary"]).toBe("#00ff00");
  });

  it("sets nothing without a revision", () => {
    expect(brandingVariables(undefined, "light")).toEqual({});
    expect(brandingVariables({}, "dark")).toEqual({});
  });
});
