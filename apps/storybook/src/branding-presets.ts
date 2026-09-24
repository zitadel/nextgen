/**
 * Tenant-style branding presets for the `<zitadel-login>` orchestrator stories.
 * Mirrors the canonical branding shape in
 * `docs/design/branding/branding.example.json`. The orchestrator stories push
 * one of these through the MSW worker so the orchestrator's CSS-token bridge
 * has a tenant payload to render.
 *
 * The `*-template` presets carry design templates as `liquid_template`:
 * `minimal-template` is the exact markup `branding eject` puts into a user's
 * repo; the split/hero presets are the retired page-layout designs (#1039),
 * kept so revisions already published from them can still be reviewed. They
 * exist so the shipped
 * designs can be reviewed here instead of only inside a scaffolded app
 * (the alpha.18 feedback round found empty-brand-pane and badge-alignment
 * regressions nobody had ever rendered). Raw vite imports, not
 * `getDefaultBrandingConfig()` — that helper reads from disk and is
 * Node-only.
 */
import type { Branding } from "@zitadel/components";

import heroTemplate from "../../../packages/components/src/orchestrator/__fixtures__/legacy-designs/hero.liquid?raw";
import splitRightTemplate from "../../../packages/components/src/orchestrator/__fixtures__/legacy-designs/split-right.liquid?raw";
import splitTemplate from "../../../packages/components/src/orchestrator/__fixtures__/legacy-designs/split.liquid?raw";
import minimalTemplate from "../../../packages/config/defaults/branding/minimal/login.liquid?raw";

const INTER_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700&display=swap";

/**
 * The logo assets are named for their *ink*, not for the surface they sit on:
 * `zitadel-logo-light.svg` is the white wordmark (for dark surfaces) and
 * `zitadel-logo-dark.svg` is the near-black one (for light surfaces). Pairing
 * them the other way round renders an invisible logo, which reads as a broken
 * layout rather than as a fixture picking the wrong file — which is why each
 * mark sits on the theme side it was drawn for.
 */
export const brandingPresets = {
  centered: {
    layout: "centered",
    theme: {
      mode: "light",
      light: {
        logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
        palette: {
          primary: "#4A90D9",
          on_primary: "#FFFFFF",
          background: "#F8FAFC",
          surface: "#FFFFFF",
          muted: "#F1F5F9",
          border: "#E2E8F0",
          text: "#0F172A",
          text_muted: "#64748B",
          link: "#2563EB",
        },
      },
    },
    typography: {
      font_family: "'Inter', ui-sans-serif, system-ui, sans-serif",
      font_url: INTER_FONT_URL,
    },
    shape: { radius: "md", density: "regular" },
  } satisfies Branding,
  split: {
    layout: "split",
    hero_url:
      "https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?auto=format&fit=crop&w=1280&q=60",
    theme: {
      mode: "light",
      light: {
        logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
        palette: {
          primary: "#4A90D9",
          on_primary: "#FFFFFF",
          background: "#FFFFFF",
          surface: "#FFFFFF",
          muted: "#F1F5F9",
          border: "#E2E8F0",
          text: "#0F172A",
          text_muted: "#64748B",
        },
      },
    },
    typography: {
      font_family: "'Inter', ui-sans-serif, system-ui, sans-serif",
      font_url: INTER_FONT_URL,
    },
  } satisfies Branding,
  dark: {
    layout: "centered",
    theme: {
      mode: "dark",
      dark: {
        logo_url: new URL("./assets/zitadel-logo-light.svg", import.meta.url).href,
        palette: {
          primary: "#7C9CFF",
          on_primary: "#0A0A0A",
          background: "#0A0A0A",
          surface: "#111111",
          muted: "#1A1A1A",
          border: "#262626",
          text: "#FAFAFA",
          text_muted: "#A1A1AA",
          link: "#9DBBFF",
        },
      },
    },
    typography: {
      font_family: "'Inter', ui-sans-serif, system-ui, sans-serif",
      font_url: INTER_FONT_URL,
    },
    shape: { radius: "md", density: "regular" },
  } satisfies Branding,
  /**
   * Both sides authored independently, with the numeric knobs at values you can
   * see: a 2px corner, text a fifth larger, a mark half again as tall. Toggle
   * the story's theme control to check that each side keeps its own colours and
   * its own ink.
   */
  "two-sided": {
    layout: "centered",
    theme: {
      mode: "auto",
      light: {
        logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
        palette: {
          primary: "#B45309",
          on_primary: "#FFFFFF",
          background: "#FFFBEB",
          surface: "#FFFFFF",
          muted: "#FEF3C7",
          border: "#FCD34D",
          text: "#451A03",
          text_muted: "#92400E",
          link: "#B45309",
        },
      },
      dark: {
        logo_url: new URL("./assets/zitadel-logo-light.svg", import.meta.url).href,
        palette: {
          primary: "#34D399",
          on_primary: "#022C22",
          background: "#022C22",
          surface: "#064E3B",
          muted: "#065F46",
          border: "#047857",
          text: "#ECFDF5",
          text_muted: "#6EE7B7",
          link: "#6EE7B7",
        },
      },
    },
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif", scale: 1.2 },
    shape: { radius: 2, density: "regular", logo_scale: 1.5 },
  } satisfies Branding,
  /**
   * One side only. The widget must render light whatever the story's theme
   * control or the operating system asks for — there are no dark colours behind
   * the request.
   */
  "light-only": {
    layout: "centered",
    theme: {
      light: {
        logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
        palette: { primary: "#4A90D9", background: "#F8FAFC", surface: "#FFFFFF", text: "#0F172A" },
      },
    },
  } satisfies Branding,
  // Ejected designs exactly as scaffolded — no palette overrides. The
  // split/hero entries are retired (#1039) and render already-published
  // revisions only.
  "split-template": {
    layout: "split",
    liquid_template: splitTemplate,
    theme: { dark: { logo_url: new URL("./assets/zitadel-logo-light.svg", import.meta.url).href } },
    hero_url:
      "https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?auto=format&fit=crop&w=1280&q=60",
  } satisfies Branding,
  "split-template-no-assets": {
    layout: "split",
    liquid_template: splitTemplate,
  } satisfies Branding,
  "split-right-template-no-assets": {
    layout: "split",
    liquid_template: splitRightTemplate,
  } satisfies Branding,
  "hero-template": {
    layout: "split",
    liquid_template: heroTemplate,
  } satisfies Branding,
  "minimal-template": {
    layout: "centered",
    liquid_template: minimalTemplate,
  } satisfies Branding,
} as const;

export type BrandingPresetId = keyof typeof brandingPresets;
