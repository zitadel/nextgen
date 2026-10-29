import { type RouterHistory, createRouter } from "@tanstack/react-router";

import { addon } from "./addon";
import { mountAddonScreens } from "./addon/screens";
import { ErrorState, NotFoundState, PendingState } from "./components/boundaries";
import { basePath } from "./lib/base-path";
import { routeTree } from "./routeTree.gen";

// The build's add-on screens join the generated tree before any router reads it.
mountAddonScreens(addon.screens);

/**
 * The single place that constructs the app router (Console ADR 0001).
 *
 * `basepath` is derived from the Vite `base` via `import.meta.env.BASE_URL`
 * so the router prefix always tracks `vite.config.ts` — `/ui/console/` for
 * production/preview builds, `/` for the dev server — without being hardcoded
 * here. The router stays agnostic to the literal value.
 *
 * `history` can be overridden so tests can drive the same router (and the same
 * shared pending/error/not-found boundaries) with an in-memory history.
 */
export function createAppRouter(options?: { history?: RouterHistory }) {
  const basepath = basePath() || undefined;

  return createRouter({
    routeTree,
    basepath,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingComponent: PendingState,
    defaultErrorComponent: ErrorState,
    defaultNotFoundComponent: NotFoundState,
    ...options,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
