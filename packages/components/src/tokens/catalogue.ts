/**
 * `--zl-*` design-token catalogue.
 *
 * Names are STABLE — once an atom consumes a token, renaming it is a breaking
 * change to the override contract. Defaults are sensible fallbacks so an atom
 * dropped on a blank page still looks reasonable.
 *
 * Spec: `docs/design/branding/tokens.md`.
 */
import type { DesignToken } from "./css-var.js";

const t = (name: `--zl-${string}`, fallback: string): DesignToken => ({
  name,
  default: fallback,
});

export const tokens = {
  color: {
    primary: t("--zl-color-primary", "#4A90D9"),
    onPrimary: t("--zl-color-on-primary", "#FFFFFF"),
    background: t("--zl-color-background", "#FFFFFF"),
    surface: t("--zl-color-surface", "#FFFFFF"),
    muted: t("--zl-color-muted", "#F1F4F9"),
    border: t("--zl-color-border", "#D8DEE6"),
    text: t("--zl-color-text", "#0F172A"),
    textMuted: t("--zl-color-text-muted", "#64748B"),
    link: t("--zl-color-link", "#2563EB"),
    success: t("--zl-color-success", "#16A34A"),
    warning: t("--zl-color-warning", "#D97706"),
    error: t("--zl-color-error", "#DC2626"),
    focusRing: t("--zl-color-focus-ring", "rgba(74, 144, 217, 0.45)"),
  },
  font: {
    family: t("--zl-font-family", "'Inter', ui-sans-serif, system-ui, sans-serif"),
    familyMono: t("--zl-font-family-mono", "ui-monospace, SFMono-Regular, monospace"),
    sizeXs: t("--zl-font-size-xs", "0.75rem"),
    sizeSm: t("--zl-font-size-sm", "0.875rem"),
    sizeMd: t("--zl-font-size-md", "1rem"),
    sizeLg: t("--zl-font-size-lg", "1.125rem"),
    sizeXl: t("--zl-font-size-xl", "1.5rem"),
    weightRegular: t("--zl-font-weight-regular", "400"),
    weightMedium: t("--zl-font-weight-medium", "500"),
    weightBold: t("--zl-font-weight-bold", "600"),
    lineHeightTight: t("--zl-line-height-tight", "1.2"),
    lineHeightNormal: t("--zl-line-height-normal", "1.5"),
  },
  radius: {
    sm: t("--zl-radius-sm", "0.25rem"),
    md: t("--zl-radius-md", "0.5rem"),
    lg: t("--zl-radius-lg", "0.75rem"),
    full: t("--zl-radius-full", "9999px"),
  },
  border: {
    width: t("--zl-border-width", "1px"),
    widthStrong: t("--zl-border-width-strong", "2px"),
  },
  space: {
    s1: t("--zl-space-1", "0.25rem"),
    s2: t("--zl-space-2", "0.5rem"),
    s3: t("--zl-space-3", "0.75rem"),
    s4: t("--zl-space-4", "1rem"),
    s5: t("--zl-space-5", "1.25rem"),
    s6: t("--zl-space-6", "1.5rem"),
    s7: t("--zl-space-7", "2rem"),
    s8: t("--zl-space-8", "2.5rem"),
  },
  control: {
    heightSm: t("--zl-control-height-sm", "2rem"),
    heightMd: t("--zl-control-height-md", "2.5rem"),
    heightLg: t("--zl-control-height-lg", "3rem"),
    paddingX: t("--zl-control-padding-x", "0.875rem"),
  },
  shadow: {
    none: t("--zl-shadow-none", "none"),
    sm: t("--zl-shadow-sm", "0 1px 2px rgba(15, 23, 42, 0.06)"),
    md: t("--zl-shadow-md", "0 4px 16px rgba(15, 23, 42, 0.08)"),
    lg: t("--zl-shadow-lg", "0 12px 32px rgba(15, 23, 42, 0.12)"),
  },
  motion: {
    durationFast: t("--zl-duration-fast", "120ms"),
    durationNormal: t("--zl-duration-normal", "200ms"),
    easeDefault: t("--zl-ease-default", "cubic-bezier(0.2, 0.8, 0.2, 1)"),
  },
} as const;

export type TokenCatalogue = typeof tokens;

export function flattenTokens(): readonly DesignToken[] {
  const acc: DesignToken[] = [];
  for (const group of Object.values(tokens)) {
    for (const value of Object.values(group)) {
      acc.push(value);
    }
  }
  return acc;
}
