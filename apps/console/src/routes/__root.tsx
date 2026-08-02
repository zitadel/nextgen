import { TanStackDevtools } from "@tanstack/react-devtools";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import "../styles.css";

/**
 * Minimal root: global styles, the outlet, and devtools. The app chrome
 * (sidebar, context bar) lives on the `_authed` pathless layout so the
 * login screen renders shell-less (Console ADR 0003).
 */
export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <Outlet />
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
