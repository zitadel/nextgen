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
    expect(css).toContain("--zl-color-surface-default-white: #FF6600;");
    expect(css).toContain("--zl-color-text-button-default: #000000;");
    expect(css).toContain("--zl-color-surface-default-black: #FAFAFA;");
  });

  it("maps palette.link to the link contract variable, not the pill token", () => {
    const css = buildBrandingStylesheet({ palette: { link: "#B97B2E" } });
    expect(css).toContain("--zl-color-text-link: #B97B2E;");
    // Regression: `link` used to target `--zl-color-text-subtitle-pink`,
    // which recolored pills while the actual links stayed on their
    // hard-coded purple accent.
    expect(css).not.toContain("--zl-color-text-subtitle-pink");
  });

  it("maps shape.radius into --zl-radius-* declarations", () => {
    const css = buildBrandingStylesheet({ shape: { radius: "lg" } });
    expect(css).toContain("--zl-radius-s: 0.75rem;");
    expect(css).toContain("--zl-radius-m:");
    expect(css).toContain("--zl-radius-l:");
  });

  it("maps shape.density to spacing overrides", () => {
    const css = buildBrandingStylesheet({ shape: { density: "compact" } });
    expect(css).toContain("--zl-spacing-03: 0.75rem;");
  });

  it("clamps typography.scale into [0.75, 1.25] and emits a scale knob", () => {
    const css = buildBrandingStylesheet({ typography: { scale: 5 } });
    expect(css).toContain("--zl-font-scale: 1.25;");
  });

  it('emits a separate :host([data-theme="dark"]) block when dark palette is present', () => {
    const css = buildBrandingStylesheet({
      palette: { background: "#FFFFFF" },
      theme: { dark: { palette: { background: "#0A0A0A" } } },
    });
    expect(css).toContain(":host {");
    expect(css).toContain(':host([data-theme="dark"]) {');
    expect(css).toContain("--zl-color-surface-default-black: #FFFFFF;");
    expect(css).toContain("--zl-color-surface-default-black: #0A0A0A;");
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
    expect(css).toContain("--zl-color-surface-default-black: #0A0A0A;");
  });

  it("ignores empty-string palette values", () => {
    const css = buildBrandingStylesheet({ palette: { primary: "" } });
    expect(css).not.toContain("--zl-color-surface-default-white");
  });

  it("maps font_family declarations to both sans and heading slots", () => {
    const css = buildBrandingStylesheet({
      typography: { font_family: "'Arimo', sans-serif" },
    });
    expect(css).toContain("--zl-font-family-sans: 'Arimo', sans-serif;");
    expect(css).toContain("--zl-font-family-heading: 'Arimo', sans-serif;");
  });

  it("fans semantic colours out to icon and border slots where applicable", () => {
    const css = buildBrandingStylesheet({
      palette: { error: "#FF0044", success: "#00CC88" },
    });
    expect(css).toContain("--zl-color-text-error: #FF0044;");
    expect(css).toContain("--zl-color-border-error: #FF0044;");
    expect(css).toContain("--zl-color-icon-error: #FF0044;");
    expect(css).toContain("--zl-color-text-success: #00CC88;");
    expect(css).toContain("--zl-color-icon-success: #00CC88;");
  });
});
