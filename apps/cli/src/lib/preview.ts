import { ZitadelError } from "./errors";

/** Seconds per unit the `--ttl` flag accepts. */
const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 24 * 60 * 60;

/** Bounds on a preview's lifetime: a minute at least, thirty days at most. */
const MIN_TTL_SECONDS = MINUTE;
const MAX_TTL_SECONDS = 30 * DAY;

/** A `--ttl`, parsed: its wire form and its duration in milliseconds. */
export type ParsedTtl = Readonly<{ wire: string; ms: number }>;

/**
 * Parse a `--ttl` like `7d`, `12h`, `90m` or `3600s` into the wire form the
 * server accepts and its duration in milliseconds. The flag takes seconds for
 * convenience, but the wire `PreviewTTL` is minutes, hours or days only, so a
 * duration in seconds is re-expressed: the coarsest unit that divides it
 * exactly, else rounded up to the next whole minute (its finest granularity).
 *
 * The lifetime is bounded to a minute at least and thirty days at most; a value
 * outside that, or one that is not a positive whole number of `s`/`m`/`h`/`d`,
 * is an `E_VALIDATION`.
 */
export function parseTtl(input: string): ParsedTtl {
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new ZitadelError("E_VALIDATION", `${input} is not a valid ttl`, {
      hint: "Use a whole number followed by s, m, h or d, e.g. 7d, 12h or 90m.",
    });
  }
  const unit = match[2] === "s" ? 1 : match[2] === "m" ? MINUTE : match[2] === "h" ? HOUR : DAY;
  const seconds = Number(match[1]) * unit;
  if (seconds < MIN_TTL_SECONDS || seconds > MAX_TTL_SECONDS) {
    throw new ZitadelError("E_VALIDATION", `${input} is outside the allowed range`, {
      hint: "A preview lives between 60s and 30d.",
    });
  }
  return { wire: ttlToWire(seconds), ms: seconds * 1000 };
}

/** The wire `PreviewTTL` for a whole number of seconds: days, hours or minutes. */
function ttlToWire(seconds: number): string {
  if (seconds % DAY === 0) {
    return `${seconds / DAY}d`;
  }
  if (seconds % HOUR === 0) {
    return `${seconds / HOUR}h`;
  }
  if (seconds % MINUTE === 0) {
    return `${seconds / MINUTE}m`;
  }
  return `${Math.ceil(seconds / MINUTE)}m`;
}

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
