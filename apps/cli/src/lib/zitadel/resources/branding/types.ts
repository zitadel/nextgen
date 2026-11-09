/**
 * The types and constants of a branding descriptor: what one holds, how a
 * descriptor written before `$file` references named its template, and the
 * login designs `branding eject` offers and refuses.
 */

import type { BrandingDesign } from "@zitadel/config/defaults";
import type { brandingConfigSchema } from "@zitadel/config/schemas";

import type { ContractValue } from "@/lib/zitadel/resources/document";

/**
 * What a branding descriptor holds once the branding contract took its body.
 */
export type BrandingValue = ContractValue<typeof brandingConfigSchema>;

/**
 * The key descriptors used before `$file` references.
 *
 * @remarks
 * Still recognised, so the finding can say how to migrate instead of
 * reporting an unknown key.
 */
export const LEGACY_TEMPLATE_FILE_KEY = "liquid_template_file";

/**
 * Where a legacy descriptor's template is taken to be when its key does not
 * name a path.
 */
export const DEFAULT_TEMPLATE_PATH = "./login.liquid";

/**
 * How the `branding eject` design picker presents one shipped login design.
 */
export type BrandingDesignInfo = {
  /**
   * The design's human-facing name.
   */
  readonly label: string;

  /**
   * One line on what the design gives.
   */
  readonly hint: string;
};

/**
 * Human-facing name and one-line hint for each shipped login design, shown by
 * the `branding eject` design picker.
 *
 * @remarks
 * Setup no longer offers designs (#1039).
 */
export const BRANDING_DESIGN_INFO: Readonly<Record<BrandingDesign, BrandingDesignInfo>> = {
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
 * Designs the eject catalog used to ship (#1039).
 *
 * @remarks
 * They were page layout around the default card, not widget structure, so they
 * are refused by name with a pointer to where page layout lives now: scripts
 * and agents that learned `--design split` get an actionable error instead of
 * oclif's generic "expected one of".
 */
export const RETIRED_BRANDING_DESIGNS = ["split", "split-right", "hero"] as const;

/**
 * Where page layout lives now, shared by every retired-design error.
 */
export const PAGE_LAYOUT_HINT =
  "Build page layout (split screens, hero panes, marketing copy) in your app around " +
  "<zitadel-login>, and theme the widget with --zl-* custom properties in your stylesheet.";
