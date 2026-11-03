import { detectPreviewUrls } from "../../../lib/preview";
import { requirement, unmet } from "../../../lib/oclif/requirements";

/**
 * The preview URLs to deploy to: `--origin`, each given once as the request's
 * unique targets require, else the ones the platform's own build variables
 * name, else none, which is a refusal.
 */
function previewUrlsFrom(
  requested: readonly string[],
  detected: () => { urls: readonly string[]; variablesLookedFor: readonly string[] },
): readonly string[] | { variables: string } {
  const unique = [...new Set(requested)];
  if (unique.length > 0) {
    return unique;
  }
  const found = detected();
  if (found.urls.length === 0) {
    return {
      variables: found.variablesLookedFor.join(", "),
    };
  }
  return [...found.urls];
}

export const previewUrls = requirement<readonly string[]>({
  refusal: {
    message: "No preview URLs to deploy to",
    hint: "Pass --origin, or run inside a pull-request build that sets one of: {variables}.",
  },
  resolve: async ({ flags, meta }) => {
    const targets = previewUrlsFrom((flags.origin as readonly string[] | undefined) ?? [], () =>
      detectPreviewUrls(meta.env),
    );
    return Array.isArray(targets) ? targets : unmet(targets as { variables: string });
  },
});
