/**
 * Resolves the Mixpanel ingestion token and API host for a CLI invocation.
 *
 * The token is a *write-only* project token: it can ingest events but cannot
 * read data back, so — unlike the project service-key — it is safe to ship
 * inside the published CLI. This mirrors how Next.js, Astro, and other dev
 * tools embed their telemetry token, and is the only workable model for a CLI
 * (we cannot ask end users to supply one). It is intentionally not a secret.
 *
 * Dev and prod are separate Mixpanel projects (the skill's Phase 2 rule: never
 * track dev traffic into the production project). By default the channel comes
 * from a build-time stamp (see {@link resolveChannel}), so the published CLI
 * routes real user traffic to production without any per-user env var while
 * source/test runs stay on dev — but a runtime `ZITADEL_TELEMETRY_ENV`/`NODE_ENV`
 * or `ZITADEL_TELEMETRY_BUILD_CHANNEL` overrides the stamp, and
 * `ZITADEL_TELEMETRY_TOKEN` overrides the token outright.
 */

/**
 * Development project token. Safe to commit (write-only ingestion key). Used
 * when running from source or any non-production build.
 */
const DEV_TELEMETRY_TOKEN = "0fb432b08a9797b87b0eebcbee11706e";

/**
 * Production project token. Used by the published CLI (the build stamps the
 * production channel) and any `ZITADEL_TELEMETRY_ENV=production` run. Write-only
 * ingestion key, like the dev token — safe to commit.
 */
const PROD_TELEMETRY_TOKEN = "f56fd7315ccd614fba8eecb2a8966152";

/** Mixpanel API hosts by data-residency region. */
const HOSTS = {
  us: "api.mixpanel.com",
  eu: "api-eu.mixpanel.com",
} as const;

export type TelemetryRegion = keyof typeof HOSTS;

declare const __ZITADEL_TELEMETRY_CHANNEL__: string | undefined;

/**
 * Channel stamped into the bundle at build time. tsdown's `define` always
 * replaces the bare `__ZITADEL_TELEMETRY_CHANNEL__` identifier — with
 * `"development"` by default and `"production"` only in the release build — so
 * the shipped CLI routes to the right project with no per-user env var. The
 * identifier is undefined only in unbundled runs (e.g. unit tests importing this
 * module directly); the `typeof` guard returns `""` there so those runs fall
 * through to the dev default without a ReferenceError.
 */
function buildStampedChannel(): string {
  return typeof __ZITADEL_TELEMETRY_CHANNEL__ === "string"
    ? __ZITADEL_TELEMETRY_CHANNEL__.toLowerCase()
    : "";
}

/**
 * Decide which project the events belong to. Precedence: an explicit runtime
 * `ZITADEL_TELEMETRY_ENV`/`NODE_ENV`, then a `ZITADEL_TELEMETRY_BUILD_CHANNEL`
 * env override (handy for CI/release), then the build-time channel stamp. The
 * default — source/dev/test — is the dev project.
 */
function resolveChannel(env: NodeJS.ProcessEnv): "development" | "production" {
  const explicit = (env.ZITADEL_TELEMETRY_ENV ?? env.NODE_ENV ?? "").toLowerCase();
  if (explicit === "production") {
    return "production";
  }
  if (explicit === "development") {
    return "development";
  }
  const stamp = (env.ZITADEL_TELEMETRY_BUILD_CHANNEL ?? buildStampedChannel()).toLowerCase();
  return stamp === "production" ? "production" : "development";
}

/**
 * Resolve the ingestion token, or `undefined` when none is configured for the
 * active channel. A `ZITADEL_TELEMETRY_TOKEN` override wins outright; otherwise
 * the channel's baked token is used. An empty string (e.g. the unset prod
 * token) resolves to `undefined`, which the caller treats as "telemetry off".
 */
export function resolveTelemetryToken(env: NodeJS.ProcessEnv): string | undefined {
  const override = env.ZITADEL_TELEMETRY_TOKEN?.trim();
  if (override) {
    return override;
  }
  const token =
    resolveChannel(env) === "production" ? PROD_TELEMETRY_TOKEN : DEV_TELEMETRY_TOKEN;
  return token.length > 0 ? token : undefined;
}

/**
 * Resolve the Mixpanel API host from `ZITADEL_TELEMETRY_REGION`. Defaults to the
 * EU host, because the Zitadel Mixpanel projects live in the EU data-residency
 * region. Set `ZITADEL_TELEMETRY_REGION=us` for a US-hosted project — events
 * sent to the wrong host are silently dropped, so verify the first event lands
 * in Live View.
 */
export function resolveTelemetryHost(env: NodeJS.ProcessEnv): string {
  const region = (env.ZITADEL_TELEMETRY_REGION ?? "eu").toLowerCase();
  return region === "us" ? HOSTS.us : HOSTS.eu;
}
