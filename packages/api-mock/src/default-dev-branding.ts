import type { MockBranding } from "./branding.js";

/**
 * Baseline branding for the standalone `api-mock` TCP server used by demo apps.
 * Matches `docs/design/branding/branding.example.json` font loading so
 * `<zitadel-login>` can inject `font_url` and paint Arimo inside the shadow tree.
 */
export const defaultDevBranding = {
  font_url:
    "https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
  typography: {
    font_family: "Arimo, ui-sans-serif, system-ui, sans-serif",
    // Zitadel's own display face. Named, not loaded: the host page declares the
    // `@font-face` (it is licensed, so the mock cannot serve it) and falls
    // through to Arimo where it hasn't.
    font_family_heading: '"APK Futural", Arimo, ui-sans-serif, system-ui, sans-serif',
  },
  theme: { mode: "dark" },
} satisfies MockBranding;
