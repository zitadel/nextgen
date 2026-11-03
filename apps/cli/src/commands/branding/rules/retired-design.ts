import { PAGE_LAYOUT_HINT } from "../../../lib/branding/designs";
import { type Rule, refuses } from "../../../lib/oclif/rules";
import { DESIGN_CATALOG, isRetiredDesign } from "../design-catalog";

/**
 * Refuses a `--design` the eject catalog used to ship, by name, with a pointer
 * to where page layout lives now, so scripts and agents that learned
 * `--design split` get an actionable error instead of oclif's generic one.
 */
export const retiredDesignRule: Rule = refuses(
  (view) => {
    return typeof view.flags.design === "string" && isRetiredDesign(view.flags.design);
  },
  {
    message: "The {design} design was retired: it was page layout, not widget structure",
    hint: `${PAGE_LAYOUT_HINT} To own the widget's structure, eject one of: ${DESIGN_CATALOG}.`,
    next: ["branding eject --design centered"],
  },
);
