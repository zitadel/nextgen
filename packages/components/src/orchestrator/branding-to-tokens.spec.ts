import { describe, expect, it } from "vitest";

import { buildBrandingStylesheet } from "./branding-to-tokens.js";

describe("buildBrandingStylesheet", () => {
  it("returns an empty string when branding is undefined", () => {
    expect(buildBrandingStylesheet(undefined)).toBe("");
  });

  it("maps palette keys to --zl-color-* declarations", () => {
    const css = buildBrandingStylesheet({
      palette: {
        primary: "#FF6600",
        on_primary: "#000000",
        background: "#FAFAFA",
      },
    });
    expect(css).toContain(":host {");
    expect(css).toContain("--zl-color-primary: #FF6600;");
    expect(css).toContain("--zl-color-on-primary: #000000;");
    expect(css).toContain("--zl-color-background: #FAFAFA;");
  });

  it("maps shape.radius into --zl-radius-* declarations", () => {
    const css = buildBrandingStylesheet({ shape: { radius: "lg" } });
    expect(css).toContain("--zl-radius-md: 0.75rem;");
    expect(css).toContain("--zl-radius-sm:");
    expect(css).toContain("--zl-radius-lg:");
  });

  it("maps shape.density to spacing/control overrides", () => {
    const css = buildBrandingStylesheet({ shape: { density: "compact" } });
    expect(css).toContain("--zl-control-height-md: 2.25rem;");
  });

  it("clamps typography.scale into [0.75, 1.25]", () => {
    const css = buildBrandingStylesheet({ typography: { scale: 5 } });
    expect(css).toContain("--zl-font-size-md: 1.25rem;");
  });

  it('emits a separate :host([data-theme="dark"]) block when dark palette is present', () => {
    const css = buildBrandingStylesheet({
      palette: { background: "#FFFFFF" },
      theme: { dark: { palette: { background: "#0A0A0A" } } },
    });
    expect(css).toContain(":host {");
    expect(css).toContain(':host([data-theme="dark"]) {');
    expect(css).toContain("--zl-color-background: #FFFFFF;");
    expect(css).toContain("--zl-color-background: #0A0A0A;");
  });

  it("merges dark overrides into :host when resolvedTheme is dark", () => {
    const css = buildBrandingStylesheet(
      {
        palette: { background: "#FFFFFF" },
        theme: { dark: { palette: { background: "#0A0A0A" } } },
      },
      { resolvedTheme: "dark" },
    );
    expect(css).not.toContain(':host([data-theme="dark"])');
    expect(css).toContain("--zl-color-background: #0A0A0A;");
  });

  it("ignores empty-string palette values", () => {
    const css = buildBrandingStylesheet({ palette: { primary: "" } });
    expect(css).not.toContain("--zl-color-primary");
  });

  it("maps font_family declarations", () => {
    const css = buildBrandingStylesheet({
      typography: { font_family: "'Arimo', sans-serif" },
    });
    expect(css).toContain("--zl-font-family: 'Arimo', sans-serif;");
  });
});
