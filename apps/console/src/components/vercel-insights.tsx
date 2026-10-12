import { useRouterState } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import { withBasePath } from "@/lib/base-path";

// Unset reports every page load; vite.config.ts rejects a value outside 0–1.
const speedInsightsSampleRate = Number(import.meta.env.CONSOLE_SPEED_INSIGHTS_SAMPLE_RATE || 1);

/**
 * Vercel Web Analytics and Speed Insights, for the console the hosted cloud
 * serves (the root route renders it only in that build). Both report the
 * matched route (`/ui/console/users/$userId`), so a screen's page views and
 * vitals add up across the resources it shows. Speed Insights reports the
 * sampled share of page loads; Web Analytics has no sampling and counts them
 * all.
 */
export function VercelInsights() {
  const route = useRouterState({ select: (state) => state.matches.at(-1)?.fullPath });
  const path = useRouterState({ select: (state) => state.location.pathname });
  const publicRoute = route === undefined ? undefined : withBasePath(route);

  return (
    <>
      <Analytics route={publicRoute} path={withBasePath(path)} />
      {/* The package reads a rate of 0 as unset, which would send every
          page load. */}
      {speedInsightsSampleRate > 0 && (
        <SpeedInsights route={publicRoute} sampleRate={speedInsightsSampleRate} />
      )}
    </>
  );
}
