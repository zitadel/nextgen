/** One hosting platform's way of announcing its preview URLs. */
type Platform = {
  /** The variables it announces them with. */
  variables: readonly string[];
  /** The preview URLs it set, as the URLs themselves. */
  urls: (env: NodeJS.ProcessEnv) => string[];
};

/**
 * The hosting platforms a pull-request build announces its preview URLs
 * through, in the order they are tried. Each reads its own variables off the
 * environment and returns the preview URLs it finds, already normalised; a
 * platform that set none of its variables contributes nothing.
 *
 * Vercel exposes bare hosts, so a scheme is prepended; Netlify exposes the full
 * deployment URL, which is used as-is. Cloudflare Pages is not detected: it
 * sets `CF_PAGES_URL` on production deployments too, and nothing in its build
 * environment marks a preview, so its URLs are passed with `--origin`.
 *
 * Only a build's preview / per-deploy URLs belong here: a platform's
 * production or canonical-site variable (e.g. `VERCEL_PROJECT_PRODUCTION_URL`,
 * Netlify's `URL`, `CI_PAGES_URL`) is deliberately excluded, since `preview`
 * must never target a production origin. Anything not detected is passed with
 * `--origin`.
 */
const PLATFORMS: ReadonlyArray<Platform> = [
  {
    variables: ["VERCEL_BRANCH_URL", "VERCEL_URL"],
    urls: (env) => {
      return [env.VERCEL_BRANCH_URL, env.VERCEL_URL]
        .filter((host): host is string => {
          return Boolean(host);
        })
        .map((host) => {
          return `https://${host}`;
        });
    },
  },
  {
    variables: ["DEPLOY_PRIME_URL", "DEPLOY_URL"],
    urls: (env) => {
      return [env.DEPLOY_PRIME_URL, env.DEPLOY_URL].filter((url): url is string => {
        return Boolean(url);
      });
    },
  },
];

/**
 * The preview URLs a hosting platform's build injected into the environment.
 * Normally only one platform's variables are present, but all are consulted so
 * a command can say exactly which it looked for when none are.
 */
export class PreviewUrls {
  /** The preview URLs found, de-duplicated, in the order the platforms list them. */
  readonly urls: readonly string[];

  /** Every variable consulted, for an error message when none were set. */
  readonly variablesLookedFor: readonly string[];

  private constructor(urls: readonly string[], variablesLookedFor: readonly string[]) {
    this.urls = urls;
    this.variablesLookedFor = variablesLookedFor;
  }

  /**
   * Reads the preview URLs off an environment.
   *
   * @param env - The environment a build runs in.
   * @returns What was found, and every variable that was looked for.
   */
  static from(env: NodeJS.ProcessEnv): PreviewUrls {
    const urls = new Set<string>();
    const variablesLookedFor: string[] = [];
    for (const platform of PLATFORMS) {
      variablesLookedFor.push(...platform.variables);
      for (const url of platform.urls(env)) {
        urls.add(url.replace(/\/+$/, ""));
      }
    }
    return new PreviewUrls([...urls], variablesLookedFor);
  }
}
