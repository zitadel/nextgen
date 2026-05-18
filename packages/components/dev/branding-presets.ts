/**
 * Branding presets for the dev playground. Mirrors the canonical branding
 * shape in `docs/design/branding/branding.example.json`. Used by
 * `dev/pages/login.ts` to push a tenant-style branding payload through the
 * MSW worker so the orchestrator's CSS-token bridge has something to render.
 */
import type { Branding } from "../src/orchestrator/index.js";

export const brandingPresets = {
  centered: {
    layout: "centered",
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
