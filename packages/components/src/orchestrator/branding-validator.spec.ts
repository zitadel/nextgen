import { describe, expect, it } from "vitest";

import { validateBranding } from "./branding-validator.js";

describe("validateBranding", () => {
  it("returns no issues for a fully valid payload", () => {
    const result = validateBranding({
      layout: "centered",
      logo_url: "https://cdn.example.com/logo.svg",
      font_url: "https://fonts.example.com/css",
      hero_url: "https://cdn.example.com/hero.jpg",
    });
    expect(result.issues).toHaveLength(0);
    expect(result.branding?.logo_url).toBe("https://cdn.example.com/logo.svg");
  });

  it("falls back to centered when layout is unknown", () => {
    const result = validateBranding({ layout: "diagonal" as never });
    expect(result.branding?.layout).toBe("centered");
    expect(result.issues).toHaveLength(1);
  });

  it("rejects http URLs", () => {
    const result = validateBranding({ logo_url: "http://insecure.example.com/logo.svg" });
    expect(result.branding?.logo_url).toBeUndefined();
    expect(result.issues[0]).toMatch(/logo_url/);
  });

  it("keeps http URLs on loopback hosts (local-dev carve-out)", () => {
    const result = validateBranding({
      logo_url: "http://localhost:3000/logo.svg",
      hero_url: "http://127.0.0.1:8080/hero.png",
      font_url: "http://[::1]:3000/font.css",
    });
    expect(result.issues).toHaveLength(0);
    expect(result.branding?.logo_url).toBe("http://localhost:3000/logo.svg");
    expect(result.branding?.hero_url).toBe("http://127.0.0.1:8080/hero.png");
    expect(result.branding?.font_url).toBe("http://[::1]:3000/font.css");
  });

  it("does not extend the loopback carve-out to lookalike or private hosts", () => {
    const lookalike = validateBranding({ logo_url: "http://localhost.evil.example/logo.svg" });
    expect(lookalike.branding?.logo_url).toBeUndefined();
    const privateRange = validateBranding({ hero_url: "http://192.168.1.10/hero.png" });
    expect(privateRange.branding?.hero_url).toBeUndefined();
  });

  it("rejects malformed URLs", () => {
    const result = validateBranding({ font_url: "not-a-url" });
    expect(result.branding?.font_url).toBeUndefined();
    expect(result.issues[0]).toMatch(/font_url/);
  });

  it("validates assets sub-object URLs", () => {
    const result = validateBranding({
      assets: {
        logo_dark: "http://insecure.example.com/dark.svg",
        favicon: "https://cdn.example.com/favicon.ico",
      },
    });
    expect(result.branding?.assets?.logo_dark).toBeUndefined();
    expect(result.branding?.assets?.favicon).toBe("https://cdn.example.com/favicon.ico");
  });

  it("returns undefined for empty input", () => {
    const result = validateBranding(undefined);
    expect(result.branding).toBeUndefined();
    expect(result.issues).toHaveLength(0);
  });
});
