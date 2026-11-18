import { fileURLToPath } from "node:url";

import { SERVER } from "@/constants";
import { ciFlag } from "./dimensions/ci-flag";

/**
 * Resolves the Mixpanel ingestion token and endpoint for a CLI invocation, and
 * the channel that decides whether a run is production traffic.
 *
 * Each Mixpanel project's token is baked in with the region it lives in: a
 * production run sends to the production project (US), and a development run
 * (CI, the CLI's own development mode, a source checkout) to the development
 * project (EU), so test traffic never reaches customer data.
 * `ZITADEL_TELEMETRY_TOKEN` overrides both. Lifecycle events also go to
 * Vercel Web Analytics (`vercel.ts`), from production runs only.
 *
 * A Mixpanel token is a *write-only* project token: it can ingest events but
 * cannot read data back, so — unlike the project service-key — it is safe to
 * ship inside the published CLI. This mirrors how Next.js, Astro, and other dev
 * tools embed their telemetry token, and is the only workable model for a CLI
 * (we cannot ask end users to supply one). It is intentionally not a secret.
 */

/** The hosted cloud's address, where released CLIs send their events. */
export const CLOUD_HOST = new URL(SERVER).host;

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
  // Nor a run of the CLI's own development mode, nor one from a checkout of its
  // source instead of the installed package.
  if (isDevelopmentFlag(env.ZITADEL_CLI_DEV) || !installedFromPackage()) {
    return "development";
  }
  return "production";
}

/**
 * Whether a development switch is on: anything but unset, empty, `0` or `false`.
 *
 * @param value - The switch's value.
 * @returns Whether it is on.
 */
function isDevelopmentFlag(value: string | undefined): boolean {
  const flag = value?.trim().toLowerCase();

  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}

/**
 * Whether this code runs from an installed package, whether through `npx`, a
 * global install or a project's `node_modules`, as opposed to a checkout of the
 * source. An installed package always sits under a `node_modules` directory.
 *
 * @returns Whether the running code lives under `node_modules`.
 */
export function installedFromPackage(): boolean {
  return fileURLToPath(import.meta.url)
    .split(/[\\/]/)
    .includes("node_modules");
}

/**
 * A Mixpanel project a run sends to: its write-only ingestion token, published
 * on purpose like the one in Next.js, and the data-residency region the project
 * lives in. A token only works against the region of its own project, so the
 * two are kept together.
 */
type Project = Readonly<{ token: string; region: TelemetryRegion }>;

/**
 * The production project, which lives in the US region.
 */
const PRODUCTION: Project = { token: "f56fd7315ccd614fba8eecb2a8966152", region: "us" };

/**
 * The development project, which lives in the EU region.
 */
const DEVELOPMENT: Project = { token: "0fb432b08a9797b87b0eebcbee11706e", region: "eu" };

/**
 * The project a run sends to: a `ZITADEL_TELEMETRY_TOKEN` override, which is
 * taken to live in the EU region unless `ZITADEL_TELEMETRY_REGION` says
 * otherwise; else the production project for a production run and the
 * development project for any other.
 *
 * @param env - The environment the run reads.
 * @returns The project to send to.
 */
function resolveProject(env: NodeJS.ProcessEnv): Project {
  const override = env.ZITADEL_TELEMETRY_TOKEN?.trim();
  if (override) {
    return { token: override, region: "eu" };
  }

  return resolveChannel(env) === "production" ? PRODUCTION : DEVELOPMENT;
}

/**
 * Resolve the Mixpanel ingestion token.
 *
 * @param env - The environment the run reads.
 * @returns The token of the project the run sends to.
 */
export function resolveTelemetryToken(env: NodeJS.ProcessEnv): string | undefined {
  return resolveProject(env).token;
}

/**
 * Resolve where Mixpanel events go: the region of the project the run sends to,
 * or the one `ZITADEL_TELEMETRY_REGION` names. Events sent to the wrong region
 * are silently dropped, so verify the first event lands in Live View.
 *
 * @param env - The environment the run reads.
 * @returns The endpoint of the region.
 */
export function resolveTelemetryEndpoint(env: NodeJS.ProcessEnv): TelemetryEndpoint {
  const named = env.ZITADEL_TELEMETRY_REGION?.trim().toLowerCase();
  const region = named === "us" || named === "eu" ? named : resolveProject(env).region;

  return ENDPOINTS[region];
}
