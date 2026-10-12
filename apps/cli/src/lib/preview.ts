/**
 * The hosting platforms a pull-request build announces its preview URLs
 * through, in the order they are tried. Each reads its own variables off the
 * environment and returns the preview URLs it finds, already normalised; a
 * platform that set none of its variables contributes nothing.
 *
 * Vercel exposes bare hosts, so a scheme is prepended; Netlify exposes full
 * URLs; Cloudflare Pages exposes the deployment URL and the branch, and both
 * the deployment URL itself and the stable branch alias derived from them
 * (`<branch>.<project>.pages.dev`) are reported.
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
    variables: ["CF_PAGES_BRANCH", "CF_PAGES_URL"],
    urls: (env) =>
      [env.CF_PAGES_URL, ...cloudflareBranchAlias(env.CF_PAGES_BRANCH, env.CF_PAGES_URL)].filter(
        (url): url is string => Boolean(url),
      ),
  },
];

/**
 * Cloudflare Pages' stable per-branch alias, `<branch>.<project>.pages.dev`.
 * The project is the deployment URL's host with its first label (the
 * per-deploy hash) dropped, and the branch is sanitised the way Cloudflare
 * does: lower-cased, non-alphanumerics folded to a dash, capped at 28
 * characters. Returns nothing when either variable is absent.
 */
function cloudflareBranchAlias(branch?: string, deploymentUrl?: string): string[] {
  if (!branch || !deploymentUrl) {
    return [];
  }
  const host = deploymentUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const project = host.slice(host.indexOf(".") + 1);
  const alias = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  if (alias === "" || project === "" || !project.includes(".")) {
    return [];
  }
  return [`https://${alias}.${project}`];
}

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
