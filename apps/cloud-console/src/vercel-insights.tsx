import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import type { AddonPage } from "@zitadel/console/addon";

// Unset reports every page load; the console's vite.config.ts rejects a value
// outside 0–1.
const speedInsightsSampleRate = Number(import.meta.env.CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE || 1);

/**
 * Vercel Web Analytics and Speed Insights, which only Vercel serves. Both
 * report the matched route (`/console/users/$userId`), so a screen's page
 * views and vitals add up across the resources it shows. Speed Insights
 * reports the sampled share of page loads; Web Analytics has no sampling and
 * counts them all.
 */
export function VercelInsights({ path, route }: AddonPage) {
  return (
    <>
      <Analytics route={route} path={path} />
      {/* The package reads a rate of 0 as unset, which would send every
          page load. */}
      {speedInsightsSampleRate > 0 && (
        <SpeedInsights route={route} sampleRate={speedInsightsSampleRate} />
      )}
    </>
  );
}
