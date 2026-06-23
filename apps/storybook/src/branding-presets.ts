/**
 * Tenant-style branding presets for the `<zitadel-login>` orchestrator stories.
 * Mirrors the canonical branding shape in
 * `docs/design/branding/branding.example.json`. The orchestrator stories push
 * one of these through the MSW worker so the orchestrator's CSS-token bridge
 * has a tenant payload to render.
 */
import type { Branding } from "@zitadel/components";

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
} as const;

export type BrandingPresetId = keyof typeof brandingPresets;
