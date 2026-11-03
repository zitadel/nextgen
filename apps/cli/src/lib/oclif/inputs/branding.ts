import { BRANDING_DESIGNS, type BrandingDesign } from "@zitadel/config/defaults";

import { PAGE_LAYOUT_HINT, RETIRED_BRANDING_DESIGNS } from "../../branding/designs";
import { refuses, type Rule } from "../rules";
import { requirement } from "../requirements";

const CATALOG = BRANDING_DESIGNS.join(", ");

function isBrandingDesign(value: string): value is BrandingDesign {
  return (BRANDING_DESIGNS as readonly string[]).includes(value);
}

function isRetired(value: string): boolean {
  return (RETIRED_BRANDING_DESIGNS as readonly string[]).includes(value);
}

/**
 * `--design` names a shipped design. A retired one is refused by name with a
 * pointer to where page layout lives now, and an unknown one lists the catalog.
 */
export const brandingDesignRules: readonly Rule[] = [
  refuses(
    (view) => {
      return typeof view.flags.design === "string" && isRetired(view.flags.design);
    },
    {
      message: "The {design} design was retired: it was page layout, not widget structure",
      hint: `${PAGE_LAYOUT_HINT} To own the widget's structure, eject one of: ${CATALOG}.`,
      next: ["branding eject --design centered"],
    },
  ),
  refuses(
    (view) => {
      return (
        typeof view.flags.design === "string" &&
        !isBrandingDesign(view.flags.design) &&
        !isRetired(view.flags.design)
      );
    },
    {
      message: 'Unknown design "{design}"',
      hint: `Pick one of: ${CATALOG}.`,
    },
  ),
];

/** The design `--design` asked for, which {@link brandingDesignRules} has already checked. */
export const requestedBrandingDesign = requirement({
  resolve: async ({ flags }) => {
    return {
      design:
        typeof flags.design === "string" && isBrandingDesign(flags.design)
          ? flags.design
          : undefined,
    };
  },
});

/**
 * `setup --design` is kept hidden only to explain its removal: setup embeds the
 * maintained login and never applies a template.
 */
export const removedSetupDesignRule: Rule = refuses(
  (view) => {
    return view.flags.design !== undefined;
  },
  {
    message: "setup no longer applies a login template, so --design was removed",
    hint: `Rerun setup without --design. ${PAGE_LAYOUT_HINT} To own the widget's structure after setup, eject one of: ${CATALOG}.`,
    next: ["branding eject"],
  },
);
