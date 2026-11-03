import { BRANDING_DESIGNS } from "@zitadel/config/defaults";

import { PAGE_LAYOUT_HINT } from "../../../lib/branding/designs";
import { type Rule, refuses } from "../../../lib/oclif/rules";

/**
 * Refuses `--design`, which setup keeps hidden only to explain its removal:
 * setup embeds the maintained login and never applies a template.
 */
export const designRemovedRule: Rule = refuses(
  (view) => {
    return view.flags.design !== undefined;
  },
  {
    message: "setup no longer applies a login template, so --design was removed",
    hint: `Rerun setup without --design. ${PAGE_LAYOUT_HINT} To own the widget's structure after setup, eject one of: ${BRANDING_DESIGNS.join(", ")}.`,
    next: ["branding eject"],
  },
);
