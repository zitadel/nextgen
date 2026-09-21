import { describe, expect, it } from "vitest";

import {
  type BrandingDraft,
  publishes,
  withFontFamily,
  withPaletteValue,
  withSectionValue,
  withSideLogo,
  withTypography,
} from "./branding-draft";

// The contract distinguishes an absent key (takes the maintained default)
// from an empty or undefined value (refused, or dropped by JSON only by
// accident), so every helper is held to dropping the key on clear.

describe("withPaletteValue", () => {
  it("creates the side and palette when the draft has neither", () => {
    const next = withPaletteValue({}, "dark", "primary", "#EB3614");
    expect(next).toEqual({ theme: { dark: { palette: { primary: "#EB3614" } } } });
  });

  it("drops the key rather than keeping an empty string", () => {
    const draft: BrandingDraft = {
      theme: { dark: { palette: { primary: "#EB3614", text: "#FFF" } } },
    };
    const next = withPaletteValue(draft, "dark", "primary", "   ");
    expect(next.theme?.dark?.palette).toEqual({ text: "#FFF" });
    expect(next.theme?.dark?.palette).not.toHaveProperty("primary");
  });

  it("leaves the other side and the rest of the draft untouched", () => {
    const draft: BrandingDraft = {
      shape: { radius: "md" },
      theme: { mode: "auto", light: { palette: { text: "#000" } } },
    };
    const next = withPaletteValue(draft, "dark", "primary", "#123456");
    expect(next.shape).toEqual({ radius: "md" });
    expect(next.theme?.mode).toBe("auto");
    expect(next.theme?.light).toEqual({ palette: { text: "#000" } });
    expect(draft.theme?.dark).toBeUndefined();
  });
});

describe("withSideLogo", () => {
  it("sets and clears a side's logo without touching its palette", () => {
    const draft: BrandingDraft = { theme: { light: { palette: { text: "#000" } } } };
    const set = withSideLogo(draft, "light", "https://cdn.example.com/logo.svg");
    expect(set.theme?.light).toEqual({
      palette: { text: "#000" },
      logo_url: "https://cdn.example.com/logo.svg",
    });
    const cleared = withSideLogo(set, "light", "");
    expect(cleared.theme?.light).toEqual({ palette: { text: "#000" } });
    expect(cleared.theme?.light).not.toHaveProperty("logo_url");
  });

  it("publishes a side once it carries anything", () => {
    expect(publishes({}, "dark")).toBe(false);
    expect(publishes(withSideLogo({}, "dark", "https://cdn.example.com/x.svg"), "dark")).toBe(true);
  });
});

describe("withTypography and withFontFamily", () => {
  it("drops a cleared string rather than publishing an empty one", () => {
    const draft: BrandingDraft = { typography: { font_family: "Arimo", scale: 1.1 } };
    const next = withTypography(draft, "font_family", "");
    expect(next.typography).toEqual({ scale: 1.1 });
    expect(next.typography).not.toHaveProperty("font_family");
  });

  it("clearing the family clears the URL with it", () => {
    const draft: BrandingDraft = {
      typography: { font_family: "Arimo", font_url: "https://cdn.example.com/font.css" },
    };
    expect(withFontFamily(draft, "").typography).toEqual({});
  });

  it("changing the family keeps the URL", () => {
    const draft: BrandingDraft = {
      typography: { font_family: "Arimo", font_url: "https://cdn.example.com/font.css" },
    };
    expect(withFontFamily(draft, "Inter").typography).toEqual({
      font_family: "Inter",
      font_url: "https://cdn.example.com/font.css",
    });
  });
});

describe("withSectionValue", () => {
  it("sets a number in a section the draft does not have yet", () => {
    expect(withSectionValue({}, "typography", "scale", 1.1)).toEqual({
      typography: { scale: 1.1 },
    });
  });

  it("drops the key on clear instead of leaving undefined behind", () => {
    const draft: BrandingDraft = { shape: { logo_scale: 1.5, density: "compact" } };
    const next = withSectionValue(draft, "shape", "logo_scale", undefined);
    expect(next.shape).toEqual({ density: "compact" });
    expect(Object.keys(next.shape ?? {})).not.toContain("logo_scale");
  });

  it("takes a preset or a pixel value for the radius", () => {
    expect(withSectionValue({}, "shape", "radius", "lg").shape).toEqual({ radius: "lg" });
    expect(withSectionValue({}, "shape", "radius", 12).shape).toEqual({ radius: 12 });
  });

  it("does not mutate the draft it was given", () => {
    const draft: BrandingDraft = { shape: { logo_scale: 1.5 } };
    withSectionValue(draft, "shape", "logo_scale", 2);
    expect(draft.shape).toEqual({ logo_scale: 1.5 });
  });
});
