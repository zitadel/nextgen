import { type Rule, refuses } from "../../../lib/oclif/rules";
import { DESIGN_CATALOG, isBrandingDesign, isRetiredDesign } from "../design-catalog";

/** Refuses a `--design` that names no design, retired or shipped, and lists the catalog. */
export const unknownDesignRule: Rule = refuses(
  (view) => {
    const design = view.flags.design;
    return typeof design === "string" && !isBrandingDesign(design) && !isRetiredDesign(design);
  },
  {
    message: 'Unknown design "{design}"',
    hint: `Pick one of: ${DESIGN_CATALOG}.`,
  },
);
