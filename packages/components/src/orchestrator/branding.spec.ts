import { describe, expect, it } from "vitest";

import { publishedSides, resolveLogoUrl } from "./branding.js";

const ON_LIGHT = "https://cdn.example.com/logo-on-light.svg";
const ON_DARK = "https://cdn.example.com/logo-on-dark.svg";
const LEGACY = "https://cdn.example.com/logo.svg";

describe("publishedSides", () => {
  it("counts a side the revision names, even with nothing set on it", () => {
    expect(publishedSides({ theme: { light: {} } })).toEqual(["light"]);
    expect(publishedSides({ theme: { light: {}, dark: {} } })).toEqual(["light", "dark"]);
  });

  it("is empty for a revision that publishes no side", () => {
    expect(publishedSides({ theme: { mode: "auto" } })).toEqual([]);
    expect(publishedSides(undefined)).toEqual([]);
  });
});

describe("resolveLogoUrl", () => {
  it("takes the mark belonging to the resolved side", () => {
    const branding = { theme: { light: { logo_url: ON_LIGHT }, dark: { logo_url: ON_DARK } } };
    expect(resolveLogoUrl(branding, "light")).toBe(ON_LIGHT);
    expect(resolveLogoUrl(branding, "dark")).toBe(ON_DARK);
  });

  it("shows no mark on a side that has none, rather than the other side's", () => {
    // The wrong ink is invisible: a mark drawn for a light card disappears on
    // a dark one, which reads as a broken page rather than a missing file.
    const branding = { theme: { light: { logo_url: ON_LIGHT }, dark: {} } };
    expect(resolveLogoUrl(branding, "dark")).toBeUndefined();
  });

  it("falls back to the legacy single mark only when neither side names one", () => {
    expect(resolveLogoUrl({ logo_url: LEGACY, theme: { dark: {} } }, "dark")).toBe(LEGACY);
    expect(resolveLogoUrl({ logo_url: LEGACY, theme: { light: { logo_url: ON_LIGHT } } }, "dark")).toBeUndefined();
  });

  it("returns the legacy mark for a revision with no theme at all", () => {
    expect(resolveLogoUrl({ logo_url: LEGACY }, "light")).toBe(LEGACY);
    expect(resolveLogoUrl(undefined, "light")).toBeUndefined();
  });
});
