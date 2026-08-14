/**
 * Tenant-style branding presets for the `<zitadel-login>` orchestrator stories.
 * Mirrors the canonical branding shape in
 * `docs/design/branding/branding.example.json`. The orchestrator stories push
 * one of these through the MSW worker so the orchestrator's CSS-token bridge
 * has a tenant payload to render.
 *
 * The `*-template` presets carry the ejectable design templates from
 * `@zitadel/config` as `liquid_template` — the exact markup `setup --design`
 * and `branding eject` put into a user's repo. They exist so the shipped
 * designs can be reviewed here instead of only inside a scaffolded app
 * (the alpha.18 feedback round found empty-brand-pane and badge-alignment
 * regressions nobody had ever rendered). Raw vite imports, not
 * `getDefaultBrandingConfig()` — that helper reads from disk and is
 * Node-only.
 */
import type { Branding } from "@zitadel/components";

import heroTemplate from "../../../packages/config/defaults/branding/hero/login.liquid?raw";
import minimalTemplate from "../../../packages/config/defaults/branding/minimal/login.liquid?raw";
import splitRightTemplate from "../../../packages/config/defaults/branding/split-right/login.liquid?raw";
import splitTemplate from "../../../packages/config/defaults/branding/split/login.liquid?raw";

const INTER_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700&display=swap";

export const brandingPresets = {
  centered: {
    layout: "centered",
    font_url: INTER_FONT_URL,
    logo_url: new URL("./assets/zitadel-logo-light.svg", import.meta.url).href,
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
    typography: {
      font_family: "'Inter', ui-sans-serif, system-ui, sans-serif",
    },
    shape: { radius: "md", density: "regular" },
  } satisfies Branding,
  split: {
    layout: "split",
    font_url: INTER_FONT_URL,
    logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
    hero_url:
      "https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?auto=format&fit=crop&w=1280&q=60",
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
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  } satisfies Branding,
  dark: {
    layout: "centered",
    font_url: INTER_FONT_URL,
    logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
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
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    shape: { radius: "md", density: "regular" },
    theme: { mode: "dark" },
  } satisfies Branding,
  // The ejected designs, exactly as scaffolded — no palette overrides, so
  // what renders here is the out-of-the-box look a fresh `setup --design`
  // user sees.
  "split-template": {
    layout: "split",
    liquid_template: splitTemplate,
    logo_url: new URL("./assets/zitadel-logo-dark.svg", import.meta.url).href,
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
