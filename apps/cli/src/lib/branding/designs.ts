import type { BrandingDesign } from "@zitadel/config/defaults";

/**
 * Human-facing name and one-line hint for each shipped login design, shown by
 * the `branding eject` design picker. Setup no longer offers designs (#1039).
 */
export const BRANDING_DESIGN_INFO: Record<BrandingDesign, { label: string; hint: string }> = {
  centered: {
    label: "Default card",
    hint: "the built-in widget, forked as an editable template",
  },
  minimal: {
    label: "Minimal",
    hint: "the same form without card chrome",
  },
};
