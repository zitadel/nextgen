import { requirement } from "../../../lib/oclif/requirements";
import { hasZitadelConfig } from "../../../lib/project";

/** Refuses a directory that is not a Zitadel project, which `setup` makes one. */
export const project = requirement({
  refusal: {
    message: "This directory is not a Zitadel project",
    hint: "Run setup first; branding files live under .zitadel/.",
    next: ["setup"],
  },
  resolve: async ({ meta }) => {
    if (!(await hasZitadelConfig(meta.cwd))) {
      return undefined;
    }
    return {
      cwd: meta.cwd,
    };
  },
});
