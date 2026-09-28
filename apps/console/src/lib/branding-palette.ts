import type { CreateFlow201Branding } from "@zitadel/api/generated/model";

/**
 * A branding revision as the wire carries it. The panel reads one; nothing in
 * the console writes one yet, so there is no second shape to drift from.
 */
export type BrandingRevision = CreateFlow201Branding;

export type ThemeSide = "light" | "dark";

/** Palette keys, in the order the panel lists them. */
export const PALETTE_KEYS = [
  "primary",
  "on_primary",
  "background",
  "surface",
  "muted",
  "text_muted",
  "text",
  "link",
  "border",
  "success",
  "warning",
  "error",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** How each palette key is labelled in the panel. */
export const PALETTE_LABELS: Record<PaletteKey, string> = {
  primary: "Primary",
  on_primary: "On primary",
  background: "Background",
  surface: "Surface",
  muted: "Muted",
  text_muted: "Muted text",
  text: "Text",
  link: "Link",
  border: "Border",
  success: "Success",
  warning: "Warning",
  error: "Error",
};
