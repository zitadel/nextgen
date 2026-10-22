import type { Properties } from "mixpanel";

/**
 * Proof of concept: a copy of each event for Vercel Web Analytics, posted the
 * way `@vercel/analytics/server` posts a custom event. Names carry a `poc_`
 * prefix so proof traffic never mixes with a released event's name.
 */

/** The cloud project's Web Analytics intake. */
export const VERCEL_ENDPOINT = "https://preview.zitadel.com/_vercel/insights/event";

/** The custom-event property limit of Web Analytics Plus. */
export const VERCEL_MAX_PROPERTIES = 8;

/** The intake's limit on an event name or value. */
const MAX_LENGTH = 255;

const EVENT_PREFIX = "poc_";

/** Where the copy goes, and which properties it keeps, in priority order. */
export type VercelSink = {
  readonly endpoint: string;
  readonly keys: readonly string[];
};

/** `ZITADEL_TELEMETRY_VERCEL_ENDPOINT` overrides the cloud's intake. */
export function resolveVercelEndpoint(env: NodeJS.ProcessEnv): string {
  return env.ZITADEL_TELEMETRY_VERCEL_ENDPOINT?.trim() || VERCEL_ENDPOINT;
}

/**
 * The intake body for one event. It keeps the first
 * {@link VERCEL_MAX_PROPERTIES} of `sink.keys` that hold a non-empty string,
 * a number or a boolean, and drops everything else.
 */
export function vercelEventBody(
  event: string,
  properties: Properties,
  sink: VercelSink,
  now: number,
): string {
  const data: Record<string, string | number | boolean> = {};
  for (const key of sink.keys) {
    if (Object.keys(data).length === VERCEL_MAX_PROPERTIES) {
      break;
    }
    const value: unknown = properties[key];
    if (typeof value === "string" && value !== "") {
      data[key] = value.slice(0, MAX_LENGTH);
    } else if (typeof value === "number" || typeof value === "boolean") {
      data[key] = value;
    }
  }
  const version = properties.cli_version;
  return JSON.stringify({
    o: new URL(sink.endpoint).origin,
    ts: now,
    sdkn: "zitadel-cli",
    sdkv: typeof version === "string" ? version : "",
    r: "",
    en: `${EVENT_PREFIX}${event}`.slice(0, MAX_LENGTH),
    ed: data,
  });
}
