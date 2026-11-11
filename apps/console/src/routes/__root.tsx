import { TanStackDevtools } from "@tanstack/react-devtools";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { addon } from "@/addon";
import type { ConsoleAddon } from "@/addon/contract";
import { Toaster } from "@/components/ui/sonner";
import { withBasePath } from "@/lib/base-path";

import "../styles.css";

/**
 * Minimal root: global styles, the outlet, the toaster, the build's add-on
 * (Vercel's insights on the hosted cloud), and devtools. The app chrome
 * (sidebar, context bar) lives on the `_authed` pathless layout so the login
 * screen renders shell-less (Console ADR 0003).
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
      {/* What the build's add-on mounts on every page (src/addon): Vercel's
          insights in the hosted cloud's build, nothing in the console the Go
          server embeds. */}
      {addon.Root && <AddonRoot Root={addon.Root} />}
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

/**
 * The add-on's root, told the page as the address bar shows it: the matched
 * route (`/console/users/$userId`) and the path, both with the deployment
 * prefix, so the add-on needs neither the router nor the base; and whether
 * the signed-in layout's guard let the page through.
 */
function AddonRoot({ Root }: { Root: NonNullable<ConsoleAddon["Root"]> }) {
  const route = useRouterState({ select: (state) => state.matches.at(-1)?.fullPath });
  const path = useRouterState({ select: (state) => state.location.pathname });
  const signedIn = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/_authed" && match.status === "success"),
  });
  return (
    <Root
      path={withBasePath(path)}
      route={route === undefined ? undefined : withBasePath(route)}
      signedIn={signedIn}
    />
  );
}
