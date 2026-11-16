import { PreviewService, type ZitadelClient } from "@/lib/backend";
import { isCancellation, toZitadelError } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";

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
const PREVIEW_PLATFORMS: ReadonlyArray<{
  variables: readonly string[];
  urls: (env: NodeJS.ProcessEnv) => string[];
}> = [
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

/**
 * A read that decorates a listing with when previews expire, which warns and
 * answers `none` when it fails instead of failing the listing.
 *
 * @remarks
 * A deployment records no expiry of its own, so a caller that shows one reads
 * it from the previews. The expiry decorates what the caller shows, so a
 * failed read reports no expiry rather than failing the run. The caller sees
 * `none` either way, so it cannot tell a failed read from an origin whose
 * preview is gone; the warning says which.
 *
 * @param read - The read that finds out, which may fail.
 * @param none - What to answer when it fails.
 * @returns What `read` answers, or `none` after a warning when it fails.
 * @throws ZitadelError `E_CANCELLED` when the run was cancelled while reading.
 */
export async function readingExpiries<T>(read: () => Promise<T>, none: T): Promise<T> {
  return read().catch((error: unknown): T => {
    if (isCancellation(error)) {
      throw error;
    }
    reportWarning(`Could not read when the previews expire: ${toZitadelError(error).message}`);
    return none;
  });
}

/**
 * When each of some preview origins expires, read from the live previews.
 *
 * @param client - The client every request goes through.
 * @param projectId - The project the previews belong to.
 * @param origins - The preview origins to look for. None are read for an
 *   empty list.
 * @returns The expiry of each origin that still has a live preview, by origin;
 *   empty when the previews cannot be read, as {@link readingExpiries} says.
 * @throws ZitadelError `E_CANCELLED` when the run was cancelled while reading.
 */
export async function liveExpiries(
  client: ZitadelClient,
  projectId: string,
  origins: Iterable<string>,
): Promise<ReadonlyMap<string, string>> {
  return readingExpiries(() => {
    return new PreviewService(client, projectId).expiries(new Set(origins));
  }, new Map<string, string>());
}
