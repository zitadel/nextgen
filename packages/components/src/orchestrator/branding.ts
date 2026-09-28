/**
 * Client-side branding shape consumed by the orchestrator.
 *
 * The appearance blocks (`theme`, `typography`, `shape`) are wire fields: a
 * branding revision stores them and flow responses project them, so they are
 * re-exported from the generated model rather than redeclared. Aliasing keeps
 * the orchestrator's vocabulary (`BrandingPalette`, `BrandingShape`) without a
 * second definition that can drift from the revision it paints.
 *
 * `attribution` is the one genuine client extension: it is a property of the
 * embedding, not of the stored revision.
 */
import type {
  CreateFlow201Branding,
  CreateFlow201BrandingLayout,
  CreateFlow201BrandingShape,
  CreateFlow201BrandingTheme,
  CreateFlow201BrandingThemeLight,
  CreateFlow201BrandingThemeLightPalette,
  CreateFlow201BrandingTypography,
} from "@zitadel/api/generated/model";

export type FlowLayout = CreateFlow201BrandingLayout;

export type BrandingPalette = CreateFlow201BrandingThemeLightPalette;

/**
 * One complete surface. Light and dark carry the same fields and neither
 * inherits from the other, so the two sides share one type.
 */
export type BrandingThemeSide = CreateFlow201BrandingThemeLight;

export type BrandingTheme = CreateFlow201BrandingTheme;

export type BrandingTypography = CreateFlow201BrandingTypography;

export type BrandingShape = CreateFlow201BrandingShape;

/** The published sides a revision offers, in the order the surface prefers them. */
export type PublishedSides = readonly ResolvableSide[];

export type ResolvableSide = "light" | "dark";

/**
 * Which sides the revision actually publishes. A side is published when the
 * revision names it at all — an empty side object still says "this surface is
 * mine", it just takes the maintained defaults for every key.
 */
export function publishedSides(branding: Branding | undefined): PublishedSides {
  const theme = branding?.theme;
  const sides: ResolvableSide[] = [];
  if (theme?.light) sides.push("light");
  if (theme?.dark) sides.push("dark");
  return sides;
}

/**
 * The mark for the resolved surface. A logo is pixels and is never recoloured,
 * so a side without its own file shows no mark rather than borrowing the other
 * side's. The legacy top-level `logo_url` is a single-mark fallback and applies
 * only when neither side names one.
 */
export function resolveLogoUrl(
  branding: Branding | undefined,
  theme: ResolvableSide,
): string | undefined {
  if (!branding) return undefined;
  const sides = branding.theme;
  const sideLogo = theme === "light" ? sides?.light?.logo_url : sides?.dark?.logo_url;
  if (sideLogo) return sideLogo;
  if (sides?.light?.logo_url || sides?.dark?.logo_url) return undefined;
  return branding.logo_url;
}

/**
 * Wire shape plus the embedding-owned attribution block.
 *
 * `attribution.show_zitadel` controls the "Secured with Zitadel" pill in
 * the orchestrator footer. Tenants set it to `false` only when they have a
 * licence that permits removing attribution (community / OSS deployments
 * always show it).
 */
export type Branding = CreateFlow201Branding & {
  attribution?: BrandingAttribution;
};

export type BrandingAttribution = {
  show_zitadel?: boolean;
  custom_link?: { label: string; href: string };
};
