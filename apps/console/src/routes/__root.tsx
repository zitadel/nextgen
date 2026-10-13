import { TanStackDevtools } from "@tanstack/react-devtools";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { Toaster } from "@/components/ui/sonner";
import { VercelInsights } from "@/components/vercel-insights";

import "../styles.css";

/**
 * Minimal root: global styles, the outlet, the toaster, Vercel's insights on
 * the hosted cloud, and devtools. The app chrome (sidebar, context bar) lives
 * on the `_authed` pathless layout so the login screen renders shell-less
 * (Console ADR 0003).
 *
 * The toaster sits at the root rather than in the shell so a toast outlives the
 * surface that raised it — deleting a user unmounts its dialog and re-renders
 * the list underneath, and the confirmation has to survive both.
 */
export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster />
      {/* Only Vercel serves these scripts: the hosted cloud's build opts in,
          the console the Go server embeds leaves them out. */}
      {import.meta.env.CONSOLE_VERCEL_INSIGHTS === "1" && <VercelInsights />}
      {import.meta.env.DEV && import.meta.env.MODE !== "test" && (
        // Bottom-left: right-anchored surfaces (the Add user drawer, and any
        // sheet after it) put their primary action in the bottom-right corner,
        // where the launcher badge sat directly on top of it.
        <TanStackDevtools
          config={{ position: "bottom-left" }}
          plugins={[{ name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> }]}
        />
      )}
    </>
  );
}
