import { track } from "@vercel/analytics";

/**
 * The console's custom events in Vercel Web Analytics, as
 * docs/product-analytics-events.yaml defines them. Only the hosted cloud's
 * build sends them, the one that loads Vercel's script
 * (`CONSOLE_VERCEL_INSIGHTS`, components/vercel-insights.tsx); every other
 * build, the one the Go server embeds included, sends nothing.
 */
type Events = {
  copied_command: { page: "projects"; snippet: "setup" };
};

/**
 * Sends `event` with the header every console event carries: `surface`, the
 * commit the cloud deployed (`CONSOLE_VERSION`) and the cloud as the server.
 */
export function trackEvent<E extends keyof Events>(event: E, properties: Events[E]): void {
  if (import.meta.env.CONSOLE_VERCEL_INSIGHTS !== "1") return;
  const version = import.meta.env.CONSOLE_VERSION;
  track(event, {
    surface: "console",
    ...(version ? { console_version: version } : {}),
    server_kind: "cloud",
    ...properties,
  });
}
