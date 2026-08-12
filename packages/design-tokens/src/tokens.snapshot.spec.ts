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
  it("keeps typed token values resolved when CSS variables alias other roles", () => {
    expect(tokens.color.surface.defaultWhite).not.toContain("var(");
    expect(tokens.color.text.buttonDefault).not.toContain("var(");
    expect(tokens.color.text.link).toBe(tokens.color.icon.defaultPurple);
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
        "color.border.defaultBlack",
        "color.border.defaultGray100",
        "color.border.defaultGray200",
        "color.border.defaultGray300",
        "color.border.defaultGray400",
        "color.border.defaultWhite",
        "color.border.error",
        "color.border.hover",
        "color.border.success",
        "color.gray.100",
        "color.gray.200",
        "color.gray.300",
        "color.gray.400",
        "color.gray.50",
        "color.gray.500",
        "color.gray.600",
        "color.gray.700",
        "color.gray.75",
        "color.gray.800",
        "color.gray.900",
        "color.icon.defaultBlack",
        "color.icon.defaultGray",
        "color.icon.defaultOrange",
        "color.icon.defaultPink",
        "color.icon.defaultPurple",
        "color.icon.defaultWhite",
        "color.icon.disabled",
        "color.icon.error",
        "color.icon.success",
        "color.surface.defaultBlack",
        "color.surface.defaultPrimaryGray",
        "color.surface.defaultSecondaryGray",
        "color.surface.defaultWhite",
        "color.surface.hoverStrong",
        "color.surface.hoverSubtle",
        "color.text.buttonDefault",
        "color.text.buttonInvert",
        "color.text.disabled",
        "color.text.error",
        "color.text.link",
        "color.text.primaryWhite",
        "color.text.secondaryGray",
        "color.text.subtitleGray",
        "color.text.subtitleOrange",
        "color.text.subtitlePink",
        "color.text.subtitlePurple",
        "color.text.success",
        "container.authCard",
        "container.page",
        "focus.color",
        "focus.offset",
        "focus.width",
        "font.family.heading",
        "font.family.mono",
        "font.family.sans",
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
        "radius.l",
        "radius.m",
        "radius.s",
        "radius.xl",
        "radius.xs",
        "spacing.01",
        "spacing.02",
        "spacing.03",
        "spacing.04",
        "spacing.05",
        "spacing.06",
        "spacing.07",
        "spacing.08",
        "spacing.09",
        "spacing.10",
        "spacing.11",
        "spacing.12",
        "spacing.13",
        "spacing.14",
        "spacing.15",
        "spacing.16",
        "syntax.boolean",
        "syntax.comment",
        "syntax.key",
        "syntax.number",
        "syntax.punctuation",
        "syntax.string",
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
        "theme.foreground",
        "theme.input",
        "theme.muted",
        "theme.mutedForeground",
        "theme.popover",
        "theme.popoverForeground",
        "theme.primary",
        "theme.primaryForeground",
        "theme.ring",
        "theme.ringOffset",
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
      ]
    `);
  });
});
