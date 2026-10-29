import { track } from "@vercel/analytics";

import {
  applyCommand,
  devCommand,
  planCommand,
  setupCommand,
  skillsCommand,
  startCommand,
} from "./commands";

// The website's custom events in Vercel Web Analytics, as
// docs/product-analytics-events.yaml defines them: what page views cannot
// show, a command copied and a call to action followed. The <Analytics /> of
// layout.tsx sends them in production and logs them in development. They go
// from the browser like the page views, so a blocker drops a visitor from
// both and the ratios between them hold.

/** Where on its page a copy button or a call to action sits. */
export type Placement = "hero" | "showcase" | "footer";

/** What a copy button copied, never its text: `all` is the hero's whole block. */
export type Snippet = "all" | "start" | "setup" | "dev" | "plan" | "apply" | "skills";

const SNIPPETS = new Map<string, Snippet>([
  [startCommand, "start"],
  [setupCommand, "setup"],
  [devCommand, "dev"],
  [planCommand, "plan"],
  [applyCommand, "apply"],
  [skillsCommand, "skills"],
]);

/** The snippet `command` is, or `undefined` for a command the catalog has no name for. */
export function snippetOf(command: string): Snippet | undefined {
  return SNIPPETS.get(command);
}

type Events = {
  copied_command: { snippet: Snippet; placement: Placement };
  clicked_link: { target: "quickstart" | "github"; placement: Placement };
};

/** A page's stable name: `home` for `/`, else its first path segment. */
export function pageOf(pathname: string): string {
  return pathname.split("/")[1] || "home";
}

/**
 * Sends `event` with the header every website event carries: `surface` and,
 * on Vercel, the commit the website was deployed from (next.config.ts).
 */
export function trackEvent<E extends keyof Events>(event: E, properties: Events[E]): void {
  const version = process.env.WEBSITE_VERSION;
  track(event, {
    surface: "website",
    ...(version ? { website_version: version } : {}),
    page: pageOf(window.location.pathname),
    ...properties,
  });
}
