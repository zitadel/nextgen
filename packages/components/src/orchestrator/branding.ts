/**
 * Client-side branding shape consumed by the orchestrator.
 *
 * The five baseline wire fields (`layout`, `liquid_template`, `logo_url`,
 * `font_url`, `hero_url`) come straight from the orval-generated
 * `CreateFlow201Branding`. The v2 "structured extension" blocks (palette /
 * typography / shape / assets / theme) are deliberately client-only — see
 * `docs/design/branding/schema.md` "Proposed structured extension". Once
 * those land on the wire we drop the extension blocks here too.
 *
 * The validator (`branding-validator.ts`) strips fields the OpenAPI doesn't
 * model if a misconfigured tenant ever leaks them down through the wire.
 */
import type {
  CreateFlow201Branding,
  CreateFlow201BrandingLayout,
} from "@zitadel/api/generated/model";

export type FlowLayout = CreateFlow201BrandingLayout;

export type BrandingPalette = {
  primary?: string;
  on_primary?: string;
  background?: string;
  surface?: string;
  muted?: string;
  border?: string;
  text?: string;
  text_muted?: string;
  link?: string;
  success?: string;
  warning?: string;
  error?: string;
};

export type BrandingTypography = {
  font_family?: string;
  /**
   * Display face for card titles and labels. Optional: without it a tenant's
   * `font_family` sets the headings too, which is the single-font look most
   * brands want. Naming it is how a brand keeps a separate display face.
   */
  font_family_heading?: string;
  font_family_mono?: string;
  scale?: number;
};

export type BrandingShape = {
  radius?: "none" | "sm" | "md" | "lg" | "full";
  density?: "compact" | "regular" | "comfortable";
};

export type BrandingTheme = {
  mode?: "light" | "dark" | "auto";
  dark?: {
    palette?: BrandingPalette;
  };
};

export type BrandingAssets = {
  logo_dark?: string;
  favicon?: string;
  background_image?: string;
};

/**
 * Wire shape (`CreateFlow201Branding`) plus the v2 client-only extension.
 * Structurally a superset, so any `CreateFlow201Branding` payload from the
 * wire is assignable to `Branding` without a cast.
 *
 * `attribution.show_zitadel` controls the "Secured with Zitadel" pill in
 * the orchestrator footer. Tenants set it to `false` only when they have a
 * licence that permits removing attribution (community / OSS deployments
 * always show it). The flag intentionally lives on `Branding` so it can
 * be overridden per-flow alongside the rest of the visual surface.
 */
export type Branding = CreateFlow201Branding & {
  palette?: BrandingPalette;
  typography?: BrandingTypography;
  shape?: BrandingShape;
  assets?: BrandingAssets;
  theme?: BrandingTheme;
  attribution?: BrandingAttribution;
};

export type BrandingAttribution = {
  show_zitadel?: boolean;
  custom_link?: { label: string; href: string };
};
