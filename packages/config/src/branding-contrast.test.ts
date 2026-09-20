import { describe, expect, it } from "vitest";

import {
  BRANDING_CONTRAST_PAIRS,
  checkBrandingContrast,
  checkPaletteContrast,
  contrastRatio,
} from "./branding-contrast.js";

describe("contrastRatio", () => {
  it("measures the extremes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#7F7F7F", "#7F7F7F")).toBeCloseTo(1, 5);
  });

  it("does not depend on the order of its arguments", () => {
    expect(contrastRatio("#EB3614", "#FAFAFA")).toBeCloseTo(
      contrastRatio("#FAFAFA", "#EB3614") as number,
      10,
    );
  });

  it("expands three-digit hex", () => {
    expect(contrastRatio("#000", "#FFF")).toBeCloseTo(21, 5);
  });

  it("measures every colour form the palette accepts", () => {
    expect(contrastRatio("rebeccapurple", "#FFFFFF")).toBeCloseTo(8.41, 2);
    // The oklch triple is a rounded spelling of sRGB red, so the ratios agree
    // to within the rounding rather than exactly.
    expect(contrastRatio("oklch(0.628 0.2577 29.23)", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FF0000", "#FFFFFF") as number,
      3,
    );
    expect(contrastRatio("color-mix(in srgb, white, black)", "#FFFFFF")).toBeCloseTo(3.98, 2);
  });

  it("refuses a translucent pair, which has no ratio until it is composited", () => {
    // `checkPaletteContrast` composites first; the bare ratio takes opaque
    // colours only, so a caller cannot get a confident answer about a blend
    // whose backdrop it never named.
    expect(contrastRatio("#FFFFFF80", "#000000")).toBeUndefined();
  });

  it("resolves currentColor against the colour the caller names", () => {
    expect(contrastRatio("currentColor", "#FFFFFF", { currentColor: "#000000" })).toBeCloseTo(21, 5);
    expect(contrastRatio("currentColor", "#FFFFFF")).toBeUndefined();
  });
});

describe("checkPaletteContrast", () => {
  it("fails the pair the branding design flags", () => {
    // On primary #FAFAFA on primary #EB3614 measures 3.97:1 — under the 4.5:1
    // a button label has to reach.
    const findings = checkPaletteContrast({ on_primary: "#FAFAFA", primary: "#EB3614" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.status).toBe("fail");
    expect(findings[0]?.ratio).toBeCloseTo(3.97, 2);
  });

  it("passes a palette that reads", () => {
    const findings = checkPaletteContrast({
      text: "#FAFAFA",
      background: "#0A0A0A",
      surface: "#121212",
      text_muted: "#A3A3A3",
    });
    expect(findings.every((f) => f.status === "pass")).toBe(true);
    expect(findings).not.toHaveLength(0);
  });

  it("measures the roles painted on muted, not only those on the card", () => {
    // The secondary button fills with `muted` and labels with `text`; the alert
    // puts `text_muted` on the same fill. A palette can read on the card and be
    // unreadable in both of those.
    const findings = checkPaletteContrast({
      text: "#6B7280",
      text_muted: "#9CA3AF",
      muted: "#4B5563",
      surface: "#FFFFFF",
    });
    const onMuted = findings.filter((f) => f.background === "muted");
    expect(onMuted).toHaveLength(2);
    expect(onMuted.every((f) => f.status === "fail")).toBe(true);
  });

  it("composites a fill over the card it sits on, not over the page", () => {
    // A half-opaque primary inside a white card reads light; measured against
    // a black page it would look like a pass.
    const findings = checkPaletteContrast({
      on_primary: "#FFFFFF",
      primary: "#FFFFFF80",
      surface: "#FFFFFF",
      background: "#000000",
    });
    const button = findings.find((f) => f.background === "primary");
    expect(button?.status).toBe("fail");
    expect(button?.ratio).toBeCloseTo(1, 2);
  });

  it("skips a pair whose colours are not both set", () => {
    // An omitted key takes the maintained default for that side, which already
    // meets the bar — reporting it would be noise about a colour nobody chose.
    expect(checkPaletteContrast({ primary: "#EB3614" })).toEqual([]);
    expect(checkPaletteContrast(undefined)).toEqual([]);
  });

  it("measures a named colour like any other", () => {
    const findings = checkPaletteContrast({ text: "rebeccapurple", surface: "#FFFFFF" });
    expect(findings.map((f) => f.status)).toEqual(["pass"]);
    expect(findings[0]?.ratio).toBeCloseTo(8.41, 2);
  });

  it("composites a translucent surface over the page behind it", () => {
    // A card at 50% over a white page reads as if it were #FFFFFF, so mid-grey
    // text on it fails — measuring against the raw value would have passed it.
    const findings = checkPaletteContrast({
      text: "#949494",
      surface: "#00000080",
      background: "#FFFFFF",
    });
    const onCard = findings.find((f) => f.background === "surface");
    expect(onCard?.status).toBe("fail");
  });

  it("reports a pair it cannot place rather than passing it", () => {
    // A translucent page background has the host application behind it, which
    // is not ours to know.
    const findings = checkPaletteContrast({ text: "#FAFAFA", background: "#00000080" });
    expect(findings.map((f) => f.status)).toEqual(["unresolved"]);
    expect(findings[0]?.ratio).toBeUndefined();
  });

  it("resolves a currentColor palette value against the side's text", () => {
    // `--zl-link` defaults to currentColor, so this is the design system's own
    // default reaching the checker rather than a hypothetical.
    const findings = checkPaletteContrast({
      text: "#0F172A",
      surface: "#FFFFFF",
      link: "currentColor",
    });
    expect(findings.every((f) => f.status === "pass")).toBe(true);
    expect(findings.some((f) => f.foreground === "link")).toBe(true);
  });

  it("holds a component boundary to the lower bar", () => {
    // #767676 on white is 4.54:1; #949494 is 2.85:1. The outline needs 3:1,
    // so the first passes and the second does not.
    const readable = checkPaletteContrast({ border: "#767676", surface: "#FFFFFF" });
    const faint = checkPaletteContrast({ border: "#D4D4D4", surface: "#FFFFFF" });
    expect(readable[0]?.status).toBe("pass");
    expect(faint[0]?.status).toBe("fail");
    expect(faint[0]?.minimum).toBe(3);
  });
});

describe("checkBrandingContrast", () => {
  it("keeps each side's findings apart", () => {
    const result = checkBrandingContrast({
      theme: {
        light: { palette: { text: "#0F172A", background: "#FFFFFF" } },
        dark: { palette: { text: "#333333", background: "#0A0A0A" } },
      },
    });
    expect(result.light[0]?.status).toBe("pass");
    expect(result.dark[0]?.status).toBe("fail");
  });

  it("is empty for a revision with no palettes", () => {
    expect(checkBrandingContrast({})).toEqual({ light: [], dark: [] });
  });
});

describe("BRANDING_CONTRAST_PAIRS", () => {
  it("names a real palette key on both ends of every pair", () => {
    const keys = new Set([
      "primary", "on_primary", "background", "surface", "muted", "border",
      "text", "text_muted", "link", "success", "warning", "error",
    ]);
    for (const pair of BRANDING_CONTRAST_PAIRS) {
      expect(keys).toContain(pair.foreground);
      expect(keys).toContain(pair.background);
    }
  });
});
