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

/**
 * Designs the eject catalog used to ship (#1039). They were page layout
 * around the default card, not widget structure, so they are refused by name
 * with a pointer to where page layout lives now — scripts and agents that
 * learned `--design split` get an actionable error instead of oclif's generic
 * "expected one of".
 */
export const RETIRED_BRANDING_DESIGNS = ["split", "split-right", "hero"] as const;

/** Where page layout lives now, shared by every retired-design error. */
export const PAGE_LAYOUT_HINT =
  "Build page layout (split screens, hero panes, marketing copy) in your app around " +
  "<zitadel-login>, and theme the widget with --zl-* custom properties in your stylesheet.";
