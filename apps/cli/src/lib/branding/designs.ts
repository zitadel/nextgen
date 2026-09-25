import { BRANDING_DESIGNS, type BrandingDesign } from "@zitadel/config/defaults";

import { ZitadelError } from "../errors";
import { publicCliCommand } from "../public-cli";

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
const PAGE_LAYOUT_HINT =
  "Build page layout (split screens, hero panes, marketing copy) in your app around " +
  "<zitadel-login>, and theme the widget with --zl-* custom properties in your stylesheet. " +
  "See docs/adrs/057-login-customization-categories.md.";

/**
 * Resolves a `branding eject --design` value to a shipped design. A retired
 * design fails with a hint naming the replacement, an unknown one lists the
 * catalog.
 */
export function resolveBrandingDesign(design: string, cliVersion: string): BrandingDesign {
  if ((BRANDING_DESIGNS as readonly string[]).includes(design)) {
    return design as BrandingDesign;
  }
  const catalog = BRANDING_DESIGNS.join(", ");
  if ((RETIRED_BRANDING_DESIGNS as readonly string[]).includes(design)) {
    throw new ZitadelError(
      "E_VALIDATION",
      `The ${design} design was retired: it was page layout, not widget structure`,
      {
        hint: `${PAGE_LAYOUT_HINT} To own the widget's structure, eject one of: ${catalog}.`,
        nextCommands: [publicCliCommand("branding eject --design centered", cliVersion)],
      },
    );
  }
  throw new ZitadelError("E_VALIDATION", `Unknown design ${JSON.stringify(design)}`, {
    hint: `Pick one of: ${catalog}.`,
  });
}

/**
 * The error for `setup --design`, which setup kept as a hidden flag only to
 * explain its removal (#1039): setup embeds the maintained login and never
 * applies a template.
 */
export function setupDesignRemovedError(cliVersion: string): ZitadelError {
  return new ZitadelError(
    "E_VALIDATION",
    "setup no longer applies a login template, so --design was removed",
    {
      hint:
        `Rerun setup without --design. ${PAGE_LAYOUT_HINT} ` +
        `To own the widget's structure after setup, eject one of: ${BRANDING_DESIGNS.join(", ")}.`,
      nextCommands: [publicCliCommand("branding eject", cliVersion)],
    },
  );
}
