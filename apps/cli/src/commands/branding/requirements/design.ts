import { requirement } from "../../../lib/oclif/requirements";
import { isBrandingDesign } from "../design-catalog";

/**
 * The design `--design` asked for, which the design rules have already checked,
 * or none when the person is to be asked. It refuses nothing.
 */
export const design = requirement({
  resolve: async ({ flags }) => {
    return {
      design:
        typeof flags.design === "string" && isBrandingDesign(flags.design)
          ? flags.design
          : undefined,
    };
  },
});
