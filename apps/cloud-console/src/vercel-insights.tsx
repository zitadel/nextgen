import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import type { AddonPage } from "@zitadel/console/addon";

// Unset reports every page load; the console's vite.config.ts rejects a value
// outside 0–1.
const speedInsightsSampleRate = Number(import.meta.env.CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE || 1);

/** The invitation page, whose link carries a token (root ADR 086 §3, §10). */
const INVITATION_PAGE = /\/invitations\/accept\/?(?:[?#]|$)/;

/**
 * Keeps the invitation page out of the page views. The console drops the
 * token from the address before this script loads, so the URL holds none;
 * leaving the page out as well means a regression there cannot leak one. The
 * page's own events (`invitation_accepted`, `invitation_rejected`) still go.
 */
export function withoutInvitationPageViews(event: BeforeSendEvent): BeforeSendEvent | null {
  return event.type === "pageview" && INVITATION_PAGE.test(event.url) ? null : event;
}

/**
 * Vercel Web Analytics and Speed Insights, which only Vercel serves. Both
 * report the matched route (`/console/users/$userId`), so a screen's page
 * views and vitals add up across the resources it shows. Speed Insights
 * reports the sampled share of page loads; Web Analytics has no sampling and
 * counts them all. Neither reports the invitation page.
 */
export function VercelInsights({ path, route }: AddonPage) {
  return (
    <>
      <Analytics route={route} path={path} beforeSend={withoutInvitationPageViews} />
      {/* The package reads a rate of 0 as unset, which would send every
          page load. */}
      {speedInsightsSampleRate > 0 && !INVITATION_PAGE.test(path) && (
        <SpeedInsights route={route} sampleRate={speedInsightsSampleRate} />
      )}
    </>
  );
}
