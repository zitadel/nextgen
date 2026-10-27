import { ciFlag } from "./dimensions/ci-flag";

/**
 * Resolves the Mixpanel ingestion token and endpoint for a CLI invocation, and
 * the channel that decides whether a run is production traffic.
 *
 * Mixpanel is paused: the production project the CLI sent to is in Mixpanel's
 * US region while its events went to the EU endpoint, which drops them. Until
 * a project and its region agree, no token is baked in, so only
 * `ZITADEL_TELEMETRY_TOKEN` sends to Mixpanel. The events still go to Vercel
 * Web Analytics (`vercel.ts`).
 *
 * A Mixpanel token is a *write-only* project token: it can ingest events but
 * cannot read data back, so — unlike the project service-key — it is safe to
 * ship inside the published CLI. This mirrors how Next.js, Astro, and other dev
 * tools embed their telemetry token, and is the only workable model for a CLI
 * (we cannot ask end users to supply one). It is intentionally not a secret.
 */

/** The hosted cloud's address, where released CLIs send their events. */
export const CLOUD_HOST = "preview.zitadel.com";

/**
 * Where Mixpanel events go, by data-residency region. EU events go through the
 * cloud: the repo-root `vercel.json` forwards `/telemetry/mixpanel/*` to
 * `api-eu.mixpanel.com`, so released CLIs name our host rather than
 * Mixpanel's. A US project is reached directly.
 */
const ENDPOINTS = {
  us: { host: "api.mixpanel.com", path: "" },
  eu: { host: CLOUD_HOST, path: "/telemetry/mixpanel" },
} as const;

export type TelemetryRegion = keyof typeof ENDPOINTS;

/** The Mixpanel client's host, and the path its requests start with. */
export type TelemetryEndpoint = { readonly host: string; readonly path: string };

/**
 * Decide whether a run's events are production traffic, which only the
 * production channel reports.
 *
 * `ZITADEL_TELEMETRY_ENV` selects `development` or `production` explicitly and
 * wins outright. With no explicit selection the default is `production`, so the
 * single generic build (no channel stamp) reports real user traffic with no
 * per-user env — EXCEPT that an unattended CI/automation run is development
 * instead. CI runs normally opt out entirely (`DO_NOT_TRACK` /
 * `ZITADEL_TELEMETRY=0`, which our own CI sets); the CI check is a belt-and-
 * braces guard so that if telemetry is somehow left on in an automated
 * environment, it can never pollute production data.
 *
 * Ambient `NODE_ENV` is deliberately NOT consulted: a run with
 * `NODE_ENV=development` must not silently switch channels.
 */
export function resolveChannel(env: NodeJS.ProcessEnv): "development" | "production" {
  const explicit = (env.ZITADEL_TELEMETRY_ENV ?? "").trim().toLowerCase();
  if (explicit === "development") {
    return "development";
  }
  if (explicit === "production") {
    return "production";
  }
  // Never let an unattended CI/automation run reach production data.
  if (ciFlag.value(env)) {
    return "development";
  }
  return "production";
}

/**
 * Resolve the Mixpanel ingestion token, or `undefined` for no Mixpanel events.
 * Mixpanel is paused, so only a `ZITADEL_TELEMETRY_TOKEN` override names one.
 */
export function resolveTelemetryToken(env: NodeJS.ProcessEnv): string | undefined {
  return env.ZITADEL_TELEMETRY_TOKEN?.trim() || undefined;
}

/**
 * Resolve where Mixpanel events go from `ZITADEL_TELEMETRY_REGION`. Defaults to
 * the EU region. Set `ZITADEL_TELEMETRY_REGION=us` for a US-hosted project —
 * events sent to the wrong region are silently dropped, so verify the first
 * event lands in Live View.
 */
export function resolveTelemetryEndpoint(env: NodeJS.ProcessEnv): TelemetryEndpoint {
  const region = (env.ZITADEL_TELEMETRY_REGION ?? "eu").trim().toLowerCase();
  return region === "us" ? ENDPOINTS.us : ENDPOINTS.eu;
}
