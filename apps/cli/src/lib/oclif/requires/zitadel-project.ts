import { hasZitadelConfig } from "../../project";
import { requirement } from "../requirements";

/** The directory the command runs in being a Zitadel project, which `setup` makes one. */
export const zitadelProject = requirement({
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
