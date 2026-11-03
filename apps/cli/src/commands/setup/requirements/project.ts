import { requirement } from "../../../lib/oclif/requirements";
import { hasZitadelConfig, hasZitadelSecret } from "../../../lib/project";

/**
 * Whether the directory is a project setup already made, and a refusal of one
 * holding the secret of a project it has no configuration for.
 */
export const project = requirement({
  refusal: {
    code: "E_CONFLICT",
    message: ".zitadel/secret exists without zitadel.json",
    hint: "Move the secret aside or restore zitadel.json before running setup.",
  },
  resolve: async ({ meta }) => {
    const configured = await hasZitadelConfig(meta.cwd);
    if (!configured && (await hasZitadelSecret(meta.cwd))) {
      return undefined;
    }
    return {
      configured,
    };
  },
});
