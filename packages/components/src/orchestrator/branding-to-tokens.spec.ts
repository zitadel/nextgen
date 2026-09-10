import { describe, expect, it } from "vitest";

import { buildBrandingStylesheet, resolveTheme } from "./branding-to-tokens.js";

const light = (palette: Record<string, string>) => ({ theme: { light: { palette } } });
const dark = (palette: Record<string, string>) => ({ theme: { dark: { palette } } });

describe("buildBrandingStylesheet", () => {
  it("returns an empty string when branding is undefined", () => {
    expect(buildBrandingStylesheet(undefined)).toBe("");
  });

  it("maps palette keys onto the semantic role variables", () => {
    const css = buildBrandingStylesheet(
      light({ primary: "#FF6600", on_primary: "#000000", background: "#FAFAFA" }),
      { resolvedTheme: "light" },
    );
    // The block names the theme attributes so it reaches the same specificity
    // as the adopted base token layer — a plain `:host` loses to it.
    expect(css).toContain(':host, :host([data-theme="light"]), :host([data-theme="dark"]) {');
    expect(css).toContain("--zl-primary: #FF6600;");
    expect(css).toContain("--zl-primary-foreground: #000000;");
    expect(css).toContain("--zl-background: #FAFAFA;");
  });

  it("maps palette.link to the link role and nothing else", () => {
    const css = buildBrandingStylesheet(light({ link: "#B97B2E" }));
    expect(css).toContain("--zl-link: #B97B2E;");
    // `link` tints exactly the link surfaces. It has twice been wired to a
    // token shared with decorative chrome, which recoloured pills and accents
    // along with it — hence a role of its own.
    expect(css).not.toContain("--zl-foreground");
    expect(css).not.toContain("--zl-muted-foreground");
  });

  it("ignores empty-string palette values", () => {
    expect(buildBrandingStylesheet(light({ primary: "" }))).not.toContain("--zl-primary");
  });

  it("fans one tenant key out to every role the design system splits it into", () => {
    const css = buildBrandingStylesheet(
      light({ border: "#334455", surface: "#112233", text: "#EEEEEE" }),
    );
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
    const css = buildBrandingStylesheet(light({ error: "#FF0044", success: "#00CC88" }));
    expect(css).toContain("--zl-destructive: #FF0044;");
    expect(css).toContain("--zl-success: #00CC88;");
  });

  describe("theme sides", () => {
    it("keeps each side's palette under its own selector", () => {
      const css = buildBrandingStylesheet({
        theme: {
          light: { palette: { background: "#FFFFFF" } },
          dark: { palette: { background: "#0A0A0A" } },
        },
      });
      expect(css).toContain(':host([data-theme="light"]) {\n  --zl-background: #FFFFFF;');
      expect(css).toContain(':host([data-theme="dark"]) {\n  --zl-background: #0A0A0A;');
    });

    it("does not fall a dark key through to the light value", () => {
      const css = buildBrandingStylesheet({
        theme: {
          light: { palette: { primary: "#4F46E5", background: "#FFFFFF" } },
          dark: { palette: { primary: "#A5B4FC" } },
        },
        // A dark side that names only `primary` keeps the maintained dark
        // background. Taking the light one would paint white behind white text.
      });
      const darkBlock = css.slice(css.lastIndexOf(':host([data-theme="dark"])'));
      expect(darkBlock).toContain("--zl-primary: #A5B4FC;");
      expect(darkBlock).not.toContain("--zl-background");
    });

    it("paints the resolved side up front so the surface is branded before data-theme lands", () => {
      const css = buildBrandingStylesheet(
        {
          theme: {
            light: { palette: { background: "#FFFFFF" } },
            dark: { palette: { background: "#0A0A0A" } },
          },
        },
        { resolvedTheme: "light" },
      );
      const upfront = css.slice(0, css.indexOf(':host([data-theme="light"]) {'));
      expect(upfront).toContain("--zl-background: #FFFFFF;");
    });

    it("emits shape and typography once, outside either side", () => {
      const css = buildBrandingStylesheet({
        typography: { font_family: "Inter, sans-serif" },
        theme: { light: { palette: { primary: "#111111" } } },
      });
      expect(css.match(/--zl-font-family-sans/g)).toHaveLength(1);
    });
  });

  describe("radius", () => {
    it("scales the whole ramp in proportion from a preset", () => {
      const css = buildBrandingStylesheet({ shape: { radius: "lg" } });
      expect(css).toContain("--zl-radius-md: 0.75rem;");
      expect(css).toContain("--zl-radius-xl: 1.3125rem;");
      // The steps the smaller atoms draw with move too: a brand that asks for
      // rounder corners should not keep square checkboxes.
      expect(css).toContain("--zl-radius-xs: 0.1875rem;");
      expect(css).toContain("--zl-radius-sm: 0.5625rem;");
    });

    it("accepts a pixel value", () => {
      const css = buildBrandingStylesheet({ shape: { radius: 10 } });
      expect(css).toContain("--zl-radius-md: 10px;");
      expect(css).toContain("--zl-radius-xl: 17.5px;");
    });

    it("squares every step off at radius none", () => {
      const css = buildBrandingStylesheet({ shape: { radius: "none" } });
      for (const step of ["xs", "sm", "md", "lg", "xl"]) {
        expect(css).toContain(`--zl-radius-${step}: 0;`);
      }
    });

    it("rounds every step fully at radius full", () => {
      const css = buildBrandingStylesheet({ shape: { radius: "full" } });
      expect(css).toContain("--zl-radius-md: 9999px;");
      expect(css).toContain("--zl-radius-xs: 9999px;");
    });
  });

  it("maps shape.density to spacing overrides", () => {
    const css = buildBrandingStylesheet({ shape: { density: "compact" } });
    expect(css).toContain("--zl-spacing-4: 0.75rem;");
  });

  it("maps shape.logo_scale to the multiplier the logo caps read", () => {
    expect(buildBrandingStylesheet({ shape: { logo_scale: 1.5 } })).toContain("--zl-logo-scale: 1.5;");
    expect(buildBrandingStylesheet({ shape: { logo_scale: 9 } })).toContain("--zl-logo-scale: 2;");
  });

  describe("typography", () => {
    it("maps font_family declarations to both sans and heading slots", () => {
      const css = buildBrandingStylesheet({
        typography: { font_family: "'Arimo', sans-serif" },
      });
      expect(css).toContain("--zl-font-family-sans: 'Arimo', sans-serif;");
      expect(css).toContain("--zl-font-family-heading: 'Arimo', sans-serif;");
    });

    it("scales the text sizes and their leading", () => {
      const css = buildBrandingStylesheet({ typography: { scale: 1.2 } });
      // 0.875rem is the step the login surface draws most of its text at.
      expect(css).toContain("--zl-text-sm-size: 1.05rem;");
      expect(css).toContain("--zl-text-sm-leading: 1.5rem;");
    });

    it("clamps the scale into [0.75, 1.25]", () => {
      const css = buildBrandingStylesheet({ typography: { scale: 5 } });
      expect(css).toContain("--zl-text-sm-size: 1.0938rem;");
    });

    it("emits no text overrides at the default scale", () => {
      expect(buildBrandingStylesheet({ typography: { scale: 1 } })).not.toContain("--zl-text-");
    });
  });
});

describe("resolveTheme", () => {
  it("uses the only published side, whatever the mode asks for", () => {
    expect(resolveTheme({ theme: { mode: "dark", light: { palette: { primary: "#111" } } } })).toBe(
      "light",
    );
    expect(resolveTheme(dark({ primary: "#EEE" }))).toBe("dark");
  });

  it("honours the mode when both sides are published", () => {
    const both = {
      theme: {
        mode: "light" as const,
        light: { palette: { primary: "#111" } },
        dark: { palette: { primary: "#EEE" } },
      },
    };
    expect(resolveTheme(both)).toBe("light");
  });

  it("falls back to dark when a revision publishes no side", () => {
    expect(resolveTheme({ typography: { font_family: "Inter, sans-serif" } })).toBe("dark");
    expect(resolveTheme(undefined)).toBe("dark");
  });
});
