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
 * track dev traffic into the production project). The channel is stamped into
 * the bundle at build time (see {@link resolveChannel}) so the published CLI
 * routes real user traffic to production without any per-user env var, while
 * source/test runs stay on dev. `ZITADEL_TELEMETRY_TOKEN` overrides everything
 * for ad-hoc routing.
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

/**
 * Whether the CLI is running from an installed package rather than a source
 * checkout: the published npm tarball (and its bundled `dist`) always lives
 * under a `node_modules` tree — via `npm i`, a global install, or `npx`/`dlx`
 * caches — while a source/dev build runs from the repo working tree. This is the
 * discriminator that routes real published-CLI traffic to the prod project
 * without any per-user env var, while source and test runs stay on dev (it also
 * keeps a locally-built `node dist/...` run on dev, so manual testing can't
 * accidentally hit prod).
 */
function isInstalledBuild(): boolean {
  return import.meta.url.includes("/node_modules/");
}

/**
 * Decide which project the events belong to. Precedence: an explicit runtime
 * `ZITADEL_TELEMETRY_ENV`/`NODE_ENV`, then a `ZITADEL_TELEMETRY_BUILD_CHANNEL`
 * stamp (handy for CI/release overrides), then auto-detection by install
 * location.
 */
function resolveChannel(env: NodeJS.ProcessEnv): "development" | "production" {
  const explicit = (env.ZITADEL_TELEMETRY_ENV ?? env.NODE_ENV ?? "").toLowerCase();
  if (explicit === "production") {
    return "production";
  }
  if (explicit === "development") {
    return "development";
  }
  const stamp = (process.env.ZITADEL_TELEMETRY_BUILD_CHANNEL ?? "").toLowerCase();
  if (stamp === "production" || stamp === "development") {
    return stamp;
  }
  return isInstalledBuild() ? "production" : "development";
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
