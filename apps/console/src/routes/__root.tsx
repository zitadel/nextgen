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
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={[{ name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> }]}
        />
      )}
    </>
  );
}
