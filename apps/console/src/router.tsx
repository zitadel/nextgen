import { type RouterHistory, createRouter } from "@tanstack/react-router";

import { ErrorState, NotFoundState, PendingState } from "./components/boundaries";
import { routeTree } from "./routeTree.gen";

/**
 * The single place that constructs the app router (Console ADR 0001).
 *
 * `basepath` is derived from the Vite `base` via `import.meta.env.BASE_URL`
 * so the router prefix always tracks `vite.config.mts` — `/ui/console/` for
 * production/preview builds, `/` for the dev server — without being hardcoded
 * here. The router stays agnostic to the literal value.
 *
 * `history` can be overridden so tests can drive the same router (and the same
 * shared pending/error/not-found boundaries) with an in-memory history.
 */
export function createAppRouter(options?: { history?: RouterHistory }) {
  const basepath = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

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
