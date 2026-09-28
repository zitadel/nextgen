import type { MockBranding } from "./branding.js";

/**
 * Baseline branding for the standalone `api-mock` TCP server used by demo apps.
 * Matches `docs/design/branding/branding.example.json` font loading so
 * `<zitadel-login>` can inject `typography.font_url` and paint Arimo inside the
 * shadow tree.
 */
export const defaultDevBranding = {
  typography: {
    // One face for body and headings. A separate display face is not part of
    // the branding revision, so the mock cannot advertise one either — a host
    // page that has licensed Zitadel's own display face declares the
    // `@font-face` itself and points `--zl-font-family-heading` at it.
    font_family: "Arimo, ui-sans-serif, system-ui, sans-serif",
    font_url:
      "https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
  },
  theme: { mode: "dark" },
} satisfies MockBranding;
