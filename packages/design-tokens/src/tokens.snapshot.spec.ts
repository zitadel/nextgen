/**
 * Locks the public token name surface.
 *
 * This is the single guardrail against a Figma sync silently renaming or
 * removing a `--zl-*` variable / `tokens.*` key. The sync workflow opens a
 * PR; this test fails on that PR if any consumer-facing name changes; the
 * reviewer either deletes the obsolete consumer references and updates
 * the snapshot, or rolls the sync back.
 *
 * It does NOT lock values — designers can adjust colours/spacing freely;
 * the build pipeline carries the new values through to the artifacts.
 */
import { describe, expect, it } from "vitest";

import { tokens } from "./generated/tokens.js";

function collectKeys(prefix: string, value: unknown, into: string[]): void {
  if (value === null || typeof value !== "object") {
    into.push(prefix);
    return;
  }
  for (const key of Object.keys(value).sort()) {
    const next = prefix === "" ? key : `${prefix}.${key}`;
    collectKeys(next, (value as Record<string, unknown>)[key], into);
  }
}

describe("design-tokens public surface", () => {
  /**
   * `tokens` is the resolved-value API — a consumer reads it to get a colour,
   * not a reference it would have to resolve itself. `cssVars` is the parallel
   * tree that hands out `var(--zl-*)`. Nothing may leak from one into the other.
   */
  it("keeps every typed token value resolved, never a var() reference", () => {
    const keys: string[] = [];
    collectKeys("", tokens, keys);
    const referencing = keys.filter((key) => {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tokens);
      return typeof value === "string" && value.includes("var(");
    });
    expect(referencing).toEqual([]);
  });

  it("token tree keys match snapshot", () => {
    const keys: string[] = [];
    collectKeys("", tokens, keys);
    expect(keys).toMatchInlineSnapshot(`
      [
        "breakpoint.2xl",
        "breakpoint.3xl",
        "breakpoint.4xl",
        "breakpoint.lg",
        "breakpoint.md",
        "breakpoint.sm",
        "breakpoint.xl",
        "breakpoint.xs",
        "container.authCard",
        "container.page",
        "focus.offset",
        "focus.width",
        "font.family.heading",
        "font.family.mono",
        "font.family.sans",
        "font.weight.black",
        "font.weight.bold",
        "font.weight.extrabold",
        "font.weight.extralight",
        "font.weight.light",
        "font.weight.medium",
        "font.weight.normal",
        "font.weight.semibold",
        "font.weight.thin",
        "gradient.baseEnd",
        "gradient.lavenderStart",
        "gradient.neutralStart",
        "gradient.purpleStart",
        "gradient.redStart",
        "gradient.roseStart",
        "motion.duration.base",
        "motion.duration.fast",
        "motion.duration.instant",
        "motion.duration.slow",
        "motion.easing.accelerate",
        "motion.easing.decelerate",
        "motion.easing.standard",
        "radius.2xl",
        "radius.3xl",
        "radius.4xl",
        "radius.full",
        "radius.lg",
        "radius.md",
        "radius.sm",
        "radius.xl",
        "radius.xs",
        "shadow.2xl",
        "shadow.2xs",
        "shadow.lg",
        "shadow.md",
        "shadow.sm",
        "shadow.xl",
        "shadow.xs",
        "spacing.0",
        "spacing.0-5",
        "spacing.1",
        "spacing.1-5",
        "spacing.10",
        "spacing.11",
        "spacing.12",
        "spacing.14",
        "spacing.16",
        "spacing.2",
        "spacing.2-5",
        "spacing.20",
        "spacing.24",
        "spacing.28",
        "spacing.3",
        "spacing.3-5",
        "spacing.32",
        "spacing.36",
        "spacing.4",
        "spacing.40",
        "spacing.44",
        "spacing.48",
        "spacing.5",
        "spacing.52",
        "spacing.56",
        "spacing.6",
        "spacing.60",
        "spacing.64",
        "spacing.7",
        "spacing.72",
        "spacing.8",
        "spacing.80",
        "spacing.9",
        "spacing.96",
        "spacing.px",
        "syntax.boolean",
        "syntax.comment",
        "syntax.key",
        "syntax.number",
        "syntax.punctuation",
        "syntax.string",
        "text.2xl.leading",
        "text.2xl.size",
        "text.3xl.leading",
        "text.3xl.size",
        "text.4xl.leading",
        "text.4xl.size",
        "text.5xl.leading",
        "text.5xl.size",
        "text.6xl.leading",
        "text.6xl.size",
        "text.7xl.leading",
        "text.7xl.size",
        "text.8xl.leading",
        "text.8xl.size",
        "text.9xl.leading",
        "text.9xl.size",
        "text.base.leading",
        "text.base.size",
        "text.lg.leading",
        "text.lg.size",
        "text.sm.leading",
        "text.sm.size",
        "text.xl.leading",
        "text.xl.size",
        "text.xs.leading",
        "text.xs.size",
        "theme.accent",
        "theme.accentForeground",
        "theme.background",
        "theme.border",
        "theme.card",
        "theme.cardForeground",
        "theme.chart1",
        "theme.chart2",
        "theme.chart3",
        "theme.chart4",
        "theme.chart5",
        "theme.destructive",
        "theme.destructiveForeground",
        "theme.destructiveRing",
        "theme.foreground",
        "theme.input",
        "theme.inputFill",
        "theme.link",
        "theme.muted",
        "theme.mutedForeground",
        "theme.popover",
        "theme.popoverForeground",
        "theme.primary",
        "theme.primaryForeground",
        "theme.ring",
        "theme.ringOffset",
        "theme.ringOutline",
        "theme.secondary",
        "theme.secondaryForeground",
        "theme.sidebar",
        "theme.sidebarAccent",
        "theme.sidebarAccentForeground",
        "theme.sidebarBorder",
        "theme.sidebarForeground",
        "theme.sidebarPrimary",
        "theme.sidebarPrimaryForeground",
        "theme.sidebarRing",
        "theme.success",
        "theme.warning",
      ]
    `);
  });
});
