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
 * track dev traffic into the production project). The channel is chosen at
 * runtime; `ZITADEL_TELEMETRY_TOKEN` overrides everything for ad-hoc routing.
 */

/**
 * Development project token. Safe to commit (write-only ingestion key). Used
 * when running from source or any non-production build.
 */
const DEV_TELEMETRY_TOKEN = "0fb432b08a9797b87b0eebcbee11706e";

/**
 * Production project token. Used for published/production builds
 * (`ZITADEL_TELEMETRY_ENV=production` or `NODE_ENV=production`). Write-only
 * ingestion key, like the dev token — safe to commit.
 */
const PROD_TELEMETRY_TOKEN = "f56fd7315ccd614fba8eecb2a8966152";

/** Mixpanel API hosts by data-residency region. */
const HOSTS = {
  us: "api.mixpanel.com",
  eu: "api-eu.mixpanel.com",
} as const;

export type TelemetryRegion = keyof typeof HOSTS;

/**
 * Decide which project the events belong to. Production is selected only when
 * explicitly signalled, so the default (running from source, local dev, CI
 * smoke tests) always lands in the dev project.
 */
function resolveChannel(env: NodeJS.ProcessEnv): "development" | "production" {
  const flag = (env.ZITADEL_TELEMETRY_ENV ?? env.NODE_ENV ?? "").toLowerCase();
  return flag === "production" ? "production" : "development";
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
 * Resolve the Mixpanel API host from `ZITADEL_TELEMETRY_REGION`. Defaults to
 * the US host (the SDK default). If the dev/prod Mixpanel project lives in the
 * EU data-residency region, set `ZITADEL_TELEMETRY_REGION=eu` — events sent to
 * the wrong host are silently dropped, so verify the first event lands in Live
 * View.
 */
export function resolveTelemetryHost(env: NodeJS.ProcessEnv): string {
  // Default to EU: the Zitadel Mixpanel projects live in the EU data-residency
  // region. Set `ZITADEL_TELEMETRY_REGION=us` for a US-hosted project.
  const region = (env.ZITADEL_TELEMETRY_REGION ?? "eu").toLowerCase();
  return region === "us" ? HOSTS.us : HOSTS.eu;
}
