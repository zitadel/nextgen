import { describe, expect, it } from "vitest";

import { brandingConfigSchema, policyTestFileSchema } from "./schemas.js";

/**
 * Direct coverage for the branding descriptor gate `zitadel plan`/`apply`
 * run. The URL rules mirror the Go save gate
 * (`internal/domain/branding_validator.go`) and the component's paint-time
 * sanitiser — a descriptor plan accepts must never be one apply rejects.
 */
describe("brandingConfigSchema", () => {
  const base = { layout: "split", liquid_template: { $file: "./login.liquid" } };

  it("accepts the template inline or as a $file reference, and rejects the old key", () => {
    const parses = (descriptor: object): boolean =>
      brandingConfigSchema.safeParse(descriptor).success;
    expect(parses({ layout: "split", liquid_template: "<p></p>" })).toBe(true);
    expect(parses(base)).toBe(true);
    expect(parses({ layout: "split", liquid_template: { $file: "" } })).toBe(false);
    expect(parses({ layout: "split", liquid_template_file: "./login.liquid" })).toBe(false);
  });

  it("accepts a descriptor with https asset URLs", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      $schema: "../meta/branding.json",
      logo_url: "https://cdn.example.com:8443/logo.svg",
      hero_url: "https://cdn.example.com:8443/hero.png",
      typography: {
        font_family: "Inter, ui-sans-serif, sans-serif",
        font_url: "https://fonts.example.com:8443/css2",
      },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("measures asset URL length in bytes, like the server", () => {
    const prefix = "https://cdn.example.com/";
    const atLimit = `${prefix}${"a".repeat(2048 - prefix.length)}`;
    // 1124 characters, but "é" is two bytes in UTF-8, so 2224 bytes.
    const multiByte = `${prefix}${"é".repeat(1100)}`;
    expect(brandingConfigSchema.safeParse({ ...base, logo_url: atLimit }).success).toBe(true);
    const result = brandingConfigSchema.safeParse({ ...base, logo_url: multiByte });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("2048 bytes");
  });

  it("rejects non-loopback http asset URLs", () => {
    for (const url of [
      "http://cdn.example.com/logo.svg",
      "http://localhost.evil.example/logo.svg",
      "http://localhost:3000@evil.example/logo.svg",
      "http://192.168.1.10/logo.svg",
      "http://127.1/logo.svg",
      "http://2130706433/logo.svg",
      "http://0x7f000001/logo.svg",
      "http://127.00.0.1/logo.svg",
      "http://[0:0:0:0:0:0:0:1]/logo.svg",
      "http://[::ffff:127.0.0.1]/logo.svg",
    ]) {
      const result = brandingConfigSchema.safeParse({ ...base, logo_url: url });
      expect(result.success, url).toBe(false);
    }
  });

  it("accepts loopback http asset URLs (local-dev carve-out)", () => {
    for (const url of [
      "http://localhost:3000/logo.svg",
      "HTTP://LOCALHOST:3000/logo.svg",
      "http://127.0.0.1:8080/logo.svg",
      "http://127.255.255.255/logo.svg",
      "http://[::1]:3000/logo.svg",
    ]) {
      const result = brandingConfigSchema.safeParse({ ...base, logo_url: url });
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it("rejects font_url without a font family", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: { font_url: "https://fonts.example.com/css2" },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("needs a typography.font_family");
  });

  it("accepts font_url alongside the family it loads", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: {
        font_family: "Inter, ui-sans-serif, sans-serif",
        font_url: "https://fonts.example.com/css2",
      },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("rejects a palette colour that could close its CSS declaration", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      theme: { light: { palette: { primary: "red; } :host { display: none" } } },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("theme.light.palette.primary");
  });

  it("rejects a non-string palette value", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      theme: { light: { palette: { primary: 123 } } },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("expected string");
  });

  it("rejects a colour that fetches a URL", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      theme: { dark: { palette: { background: "url(https://evil.example/beacon.png)" } } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a font stack that could close its CSS declaration", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: { font_family: "Inter; } :host { display: none" },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("typography.font_family");
  });

  it("rejects an http theme-side logo", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      theme: { dark: { logo_url: "http://cdn.example.com/on-dark.svg" } },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("theme.dark.logo_url");
  });

  it("rejects an http font_url — a stylesheet has no loopback carve-out", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: { font_family: "Inter", font_url: "http://localhost:3000/font.css" },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("typography.font_url");
  });

  it("words the http font_url error as the server does, without the loopback carve-out", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: { font_family: "Inter", font_url: "http://localhost:3000/font.css" },
    });
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages).toContain("typography.font_url must be an absolute https URL.");
    expect(messages.join("\n")).not.toContain("loopback");
  });

  it("rejects a URL carrying credentials", () => {
    for (const [field, doc] of [
      ["logo_url", { ...base, logo_url: "https://user:pass@cdn.example.com/logo.svg" }],
      [
        "typography.font_url",
        {
          ...base,
          typography: { font_family: "Inter", font_url: "https://user:pass@fonts.example.com/c" },
        },
      ],
    ] as const) {
      const result = brandingConfigSchema.safeParse(doc);
      expect(result.success, `${field} accepted credentials`).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("credentials");
    }
  });

  it("accepts the appearance blocks", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      theme: {
        mode: "auto",
        light: {
          logo_url: "https://cdn.example.com/on-light.svg",
          palette: { primary: "#4F46E5", link: "rebeccapurple" },
        },
        dark: {
          logo_url: "https://cdn.example.com/on-dark.svg",
          palette: { primary: "color-mix(in oklab, #A5B4FC 40%, white)" },
        },
      },
      shape: { radius: 10, density: "regular", logo_scale: 1.5 },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("rejects unknown keys, including inside a $file reference", () => {
    expect(brandingConfigSchema.safeParse({ ...base, hero_urll: "x" }).success).toBe(false);
    expect(
      brandingConfigSchema.safeParse({
        ...base,
        liquid_template: { $file: "./login.liquid", extra: 1 },
      }).success,
    ).toBe(false);
  });
});

/**
 * The gate `zitadel policies test` runs on a `.zitadel/policies/*.test.json`
 * file before it sends a case: strict like the editor's `policy-test.json`.
 */
describe("policyTestFileSchema", () => {
  const testCase = {
    name: "too short",
    input: { password: "short1" },
    expect: { allowed: false, violations: ["min_length"] },
  };
  const file = { operation: "auth.factor.password.set", cases: [testCase] };
  const parses = (value: object): boolean => policyTestFileSchema.safeParse(value).success;

  it("accepts cases with input, facts and an expectation", () => {
    expect(parses(file)).toBe(true);
    expect(
      parses({
        ...file,
        cases: [{ ...testCase, facts: { self_service: false, history_matches: [true] } }],
      }),
    ).toBe(true);
  });

  it.each([
    ["no cases", { ...file, cases: [] }],
    ["an unknown input", { ...file, cases: [{ ...testCase, input: { passwd: "x" } }] }],
    ["an unknown fact", { ...file, cases: [{ ...testCase, facts: { admin: true } }] }],
    ["an unnamed case", { ...file, cases: [{ ...testCase, name: "" }] }],
    ["no expectation", { ...file, cases: [{ name: "x", input: { password: "x" } }] }],
    ["an unknown top-level key", { ...file, config: {} }],
    [
      "an allowed case with violations",
      { ...file, cases: [{ ...testCase, expect: { allowed: true, violations: ["min_length"] } }] },
    ],
    [
      "an allowed case with a code",
      { ...file, cases: [{ ...testCase, expect: { allowed: true, code: "user.password_empty" } }] },
    ],
  ])("refuses %s", (_, value) => {
    expect(parses(value)).toBe(false);
  });
});
