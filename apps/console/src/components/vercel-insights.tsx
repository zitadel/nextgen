import { useRouterState } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import { withBasePath } from "@/lib/base-path";

/**
 * Vercel Web Analytics and Speed Insights, for the console the hosted cloud
 * serves (the root route renders it only in that build). Both report the
 * matched route (`/ui/console/users/$userId`), so a screen's page views and
 * vitals add up across the resources it shows.
 */
export function VercelInsights() {
  const route = useRouterState({ select: (state) => state.matches.at(-1)?.fullPath });
  const path = useRouterState({ select: (state) => state.location.pathname });
  const publicRoute = route === undefined ? undefined : withBasePath(route);

  return (
    <>
      <Analytics route={publicRoute} path={withBasePath(path)} />
      <SpeedInsights route={publicRoute} />
    </>
  );
}
