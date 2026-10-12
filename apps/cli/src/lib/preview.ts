/**
 * The hosting platforms a pull-request build announces its preview URLs
 * through, in the order they are tried. Each reads its own variables off the
 * environment and returns the preview URLs it finds, already normalised; a
 * platform that set none of its variables contributes nothing.
 *
 * Vercel exposes bare hosts, so a scheme is prepended; Netlify and Cloudflare
 * Pages expose the full deployment URL, which is used as-is. (Cloudflare's
 * stable per-branch alias is not reconstructed here — see #1692.)
 */
const PREVIEW_PLATFORMS: ReadonlyArray<{
  variables: readonly string[];
  urls: (env: NodeJS.ProcessEnv) => string[];
}> = [
  {
    variables: ["VERCEL_BRANCH_URL", "VERCEL_URL"],
    urls: (env) =>
      [env.VERCEL_BRANCH_URL, env.VERCEL_URL]
        .filter((host): host is string => Boolean(host))
        .map((host) => `https://${host}`),
  },
  {
    variables: ["DEPLOY_PRIME_URL", "DEPLOY_URL"],
    urls: (env) =>
      [env.DEPLOY_PRIME_URL, env.DEPLOY_URL].filter((url): url is string => Boolean(url)),
  },
  {
    variables: ["CF_PAGES_URL"],
    urls: (env) => [env.CF_PAGES_URL].filter((url): url is string => Boolean(url)),
  },
];

/** What {@link detectPreviewUrls} resolved from the environment. */
export type DetectedPreviews = Readonly<{
  /** The preview URLs found, de-duplicated, in the order the platforms list them. */
  urls: readonly string[];
  /** Every variable consulted, for an error message when none were set. */
  variablesLookedFor: readonly string[];
}>;

/**
 * The preview URLs a hosting platform's build injected, read from the
 * environment. Normally only one platform's variables are present, but all are
 * consulted so a command can say exactly which it looked for when none are.
 */
export function detectPreviewUrls(env: NodeJS.ProcessEnv): DetectedPreviews {
  const urls = new Set<string>();
  const variablesLookedFor: string[] = [];
  for (const platform of PREVIEW_PLATFORMS) {
    variablesLookedFor.push(...platform.variables);
    for (const url of platform.urls(env)) {
      urls.add(url.replace(/\/+$/, ""));
    }
  }
  return { urls: [...urls], variablesLookedFor };
}
