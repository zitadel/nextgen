import type { CreateFlow201Branding } from "@zitadel/api/generated/model";

/**
 * The branding a customer is editing, before anything is published.
 *
 * Same shape as the revision on the wire — the draft is what a publish sends,
 * so a second type here would be a place for the two to drift.
 */
export type BrandingDraft = CreateFlow201Branding;

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

/**
 * Replace one palette value on one side, dropping the key when the value is
 * cleared: an absent key takes the maintained default for that side, which is
 * not the same as publishing an empty string.
 */
export function withPaletteValue(
  draft: BrandingDraft,
  side: ThemeSide,
  key: PaletteKey,
  value: string,
): BrandingDraft {
  const theme = draft.theme ?? {};
  const current = theme[side] ?? {};
  const palette = { ...(current.palette ?? {}) };
  if (value.trim() === "") {
    delete palette[key];
  } else {
    palette[key] = value;
  }
  return { ...draft, theme: { ...theme, [side]: { ...current, palette } } };
}

/** Replace one side's logo, dropping the key when it is cleared. */
export function withSideLogo(draft: BrandingDraft, side: ThemeSide, url: string): BrandingDraft {
  const theme = draft.theme ?? {};
  const current = { ...(theme[side] ?? {}) };
  if (url.trim() === "") {
    delete current.logo_url;
  } else {
    current.logo_url = url;
  }
  return { ...draft, theme: { ...theme, [side]: current } };
}

/** Whether the revision publishes this side at all. */
export function publishes(draft: BrandingDraft, side: ThemeSide): boolean {
  return draft.theme?.[side] !== undefined;
}

/** Corner presets the contract names, alongside a pixel value. */
export const RADIUS_PRESETS = ["none", "sm", "md", "lg", "full"] as const;

export type BrandingRadius = NonNullable<NonNullable<BrandingDraft["shape"]>["radius"]>;

export const DENSITIES = ["compact", "regular", "comfortable"] as const;

export type BrandingDensity = NonNullable<NonNullable<BrandingDraft["shape"]>["density"]>;

/** Which published sides may run, `auto` following the viewer's preference. */
export const THEME_MODES = ["light", "dark", "auto"] as const;

export type BrandingThemeMode = NonNullable<NonNullable<BrandingDraft["theme"]>["mode"]>;
