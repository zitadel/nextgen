import type { Properties } from "mixpanel";

import { CLOUD_HOST, resolveChannel } from "./config";

/**
 * A copy of each event for Vercel Web Analytics, under the event's own name,
 * posted the way `@vercel/analytics/server` posts a custom event.
 */

/** The cloud project's Web Analytics intake. */
export const VERCEL_ENDPOINT = `https://${CLOUD_HOST}/_vercel/insights/event`;

/** The custom-event property limit of Web Analytics Plus. */
export const VERCEL_MAX_PROPERTIES = 8;

/** The intake's limit on an event name or value. */
const MAX_LENGTH = 255;

/** Where the copy goes, and which properties it keeps, in priority order. */
export type VercelTarget = {
  readonly endpoint: string;
  readonly keys: readonly string[];
};

/**
 * Where the copy goes, or `undefined` for no copy. A run on the development
 * channel (CI included) sends none: the cloud's intake has no dev counterpart.
 * `ZITADEL_TELEMETRY_VERCEL_ENDPOINT` names an intake for any run, and one that
 * is not a URL names none.
 */
export function resolveVercelEndpoint(env: NodeJS.ProcessEnv): string | undefined {
  const override = env.ZITADEL_TELEMETRY_VERCEL_ENDPOINT?.trim();
  if (override) {
    return URL.canParse(override) ? override : undefined;
  }
  return resolveChannel(env) === "production" ? VERCEL_ENDPOINT : undefined;
}

/**
 * The intake body for one event. It keeps the first
 * {@link VERCEL_MAX_PROPERTIES} of `target.keys` that hold a non-empty string,
 * a number or a boolean, and drops everything else.
 */
export function vercelEventBody(
  event: string,
  properties: Properties,
  target: VercelTarget,
  now: number,
): string {
  const data: Record<string, string | number | boolean> = {};
  for (const key of target.keys) {
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
    o: new URL(target.endpoint).origin,
    ts: now,
    sdkn: "zitadel-cli",
    sdkv: typeof version === "string" ? version : "",
    r: "",
    en: event.slice(0, MAX_LENGTH),
    ed: data,
  });
}
