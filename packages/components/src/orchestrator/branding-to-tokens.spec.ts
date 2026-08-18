import { describe, expect, it } from "vitest";

import { buildBrandingStylesheet } from "./branding-to-tokens.js";

describe("buildBrandingStylesheet", () => {
  it("returns an empty string when branding is undefined", () => {
    expect(buildBrandingStylesheet(undefined)).toBe("");
  });

  it("maps palette keys onto the semantic role variables", () => {
    const css = buildBrandingStylesheet({
      palette: {
        primary: "#FF6600",
        on_primary: "#000000",
        background: "#FAFAFA",
      },
    });
    // The block names the theme attributes so it reaches the same specificity
    // as the adopted base token layer — a plain `:host` loses to it.
    expect(css).toContain(':host, :host([data-theme="light"]), :host([data-theme="dark"]) {');
    expect(css).toContain("--zl-primary: #FF6600;");
    expect(css).toContain("--zl-primary-foreground: #000000;");
    expect(css).toContain("--zl-background: #FAFAFA;");
  });

  it("maps palette.link to the link role and nothing else", () => {
    const css = buildBrandingStylesheet({ palette: { link: "#B97B2E" } });
    expect(css).toContain("--zl-link: #B97B2E;");
    // `link` tints exactly the link surfaces. It has twice been wired to a
    // token shared with decorative chrome, which recoloured pills and accents
    // along with it — hence a role of its own.
    expect(css).not.toContain("--zl-foreground");
    expect(css).not.toContain("--zl-muted-foreground");
  });

  it("maps shape.radius into --zl-radius-* declarations", () => {
    const css = buildBrandingStylesheet({ shape: { radius: "lg" } });
    expect(css).toContain("--zl-radius-md: 0.75rem;");
    expect(css).toContain("--zl-radius-lg:");
    expect(css).toContain("--zl-radius-xl:");
  });

  it("maps shape.density to spacing overrides", () => {
    const css = buildBrandingStylesheet({ shape: { density: "compact" } });
    expect(css).toContain("--zl-spacing-4: 0.75rem;");
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
    expect(css).toContain(':host, :host([data-theme="light"]), :host([data-theme="dark"]) {');
    expect(css).toContain("--zl-background: #FFFFFF;");
    expect(css).toContain("--zl-background: #0A0A0A;");
    // The dark-only block comes last, so it wins on order over the general one.
    expect(css.lastIndexOf(':host([data-theme="dark"]) {')).toBeGreaterThan(
      css.indexOf(":host,"),
    );
  });

  it("merges dark overrides into :host when resolvedTheme is dark", () => {
    const css = buildBrandingStylesheet(
      {
        palette: { background: "#FFFFFF" },
        theme: { dark: { palette: { background: "#0A0A0A" } } },
      },
      { resolvedTheme: "dark" },
    );
    // Merged means one block, rather than a general one plus a dark override.
    expect(css.split("{")).toHaveLength(2);
    expect(css).toContain("--zl-background: #0A0A0A;");
    expect(css).not.toContain("--zl-background: #FFFFFF;");
  });

  it("ignores empty-string palette values", () => {
    const css = buildBrandingStylesheet({ palette: { primary: "" } });
    expect(css).not.toContain("--zl-primary");
  });

  it("maps font_family declarations to both sans and heading slots", () => {
    const css = buildBrandingStylesheet({
      typography: { font_family: "'Arimo', sans-serif" },
    });
    expect(css).toContain("--zl-font-family-sans: 'Arimo', sans-serif;");
    expect(css).toContain("--zl-font-family-heading: 'Arimo', sans-serif;");
  });

  it("fans one tenant key out to every role the design system splits it into", () => {
    const css = buildBrandingStylesheet({
      palette: { border: "#334455", surface: "#112233", text: "#EEEEEE" },
    });
    // A brand picks one "border" colour; the card edge and the control edge
    // are separate roles internally and both take it.
    expect(css).toContain("--zl-border: #334455;");
    expect(css).toContain("--zl-input: #334455;");
    expect(css).toContain("--zl-card: #112233;");
    expect(css).toContain("--zl-popover: #112233;");
    expect(css).toContain("--zl-foreground: #EEEEEE;");
    expect(css).toContain("--zl-card-foreground: #EEEEEE;");
  });

  it("maps error and success onto their single roles", () => {
    const css = buildBrandingStylesheet({
      palette: { error: "#FF0044", success: "#00CC88" },
    });
    expect(css).toContain("--zl-destructive: #FF0044;");
    expect(css).toContain("--zl-success: #00CC88;");
  });
});
