import type { MockBranding } from "./branding.js";

/**
 * Baseline branding for the standalone `api-mock` TCP server used by demo apps.
 *
 * It sets no typography, like a real server with no branding revision: the
 * login renders in the token stack's system fallback and the demos make no
 * request to a font CDN. A test or demo that wants a face applies its own
 * `typography.font_url` with `applyBranding(...)`.
 */
export const defaultDevBranding = {
  theme: { mode: "dark" },
} satisfies MockBranding;
