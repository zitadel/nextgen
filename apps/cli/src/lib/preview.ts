/**
 * The hosting platforms a pull-request build announces its preview URLs
 * through, in the order they are tried. Each reads its own variables off the
 * environment and returns the preview URLs it finds, already normalised; a
 * platform that set none of its variables contributes nothing.
 *
 * Vercel exposes bare hosts, so a scheme is prepended; Netlify exposes the full
 * deployment URL, which is used as-is. Cloudflare Pages is not detected: it
 * sets `CF_PAGES_URL` on production deployments too, and nothing in its build
 * environment marks a preview, so its URLs are passed with `--origin` (#1692).
 *
 * Only a build's preview / per-deploy URLs belong here: a platform's
 * production or canonical-site variable (e.g. `VERCEL_PROJECT_PRODUCTION_URL`,
 * Netlify's `URL`, `CI_PAGES_URL`) is deliberately excluded, since `preview`
 * must never target a production origin. Anything not detected is passed with
 * `--origin`.
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
