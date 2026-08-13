import { describe, expect, it } from "vitest";

import { brandingConfigSchema } from "./schemas.js";

/**
 * Direct coverage for the branding descriptor gate `zitadel plan`/`apply`
 * run. The URL rules mirror the Go save gate
 * (`internal/domain/branding_validator.go`) and the component's paint-time
 * sanitiser — a descriptor plan accepts must never be one apply rejects.
 */
describe("brandingConfigSchema", () => {
  const base = { layout: "split", liquid_template_file: "./login.liquid" };

  it("accepts a descriptor with https asset URLs", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      $schema: "../meta/branding.json",
      logo_url: "https://cdn.example.com/logo.svg",
      hero_url: "https://cdn.example.com/hero.png",
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("rejects non-loopback http asset URLs", () => {
    for (const url of [
      "http://cdn.example.com/logo.svg",
      "http://localhost.evil.example/logo.svg",
      "http://192.168.1.10/logo.svg",
    ]) {
      const result = brandingConfigSchema.safeParse({ ...base, logo_url: url });
      expect(result.success, url).toBe(false);
    }
  });

  it("accepts loopback http asset URLs (local-dev carve-out)", () => {
    for (const url of [
      "http://localhost:3000/logo.svg",
      "http://127.0.0.1:8080/logo.svg",
      "http://[::1]:3000/logo.svg",
    ]) {
      const result = brandingConfigSchema.safeParse({ ...base, logo_url: url });
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it("rejects font_url — read-only in v1 (ADR 040)", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      font_url: "https://fonts.example.com/css2",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("font_url is not writable yet");
  });

  it("rejects unknown keys and double template carriers", () => {
    expect(brandingConfigSchema.safeParse({ ...base, hero_urll: "x" }).success).toBe(false);
    expect(
      brandingConfigSchema.safeParse({ ...base, liquid_template: "<zl-card></zl-card>" }).success,
    ).toBe(false);
  });
});
