import { type AnyRoute, createRoute, redirect, useRouter } from "@tanstack/react-router";

import type { AddonScreen, AddonSignedOutScreen } from "@/addon/contract";
import { fetchSession, sanitizeNextPath } from "@/auth/session";
import { stringParam } from "@/lib/search-params";
import { Route as rootRoute } from "@/routes/__root";
import { Route as authedRoute } from "@/routes/_authed";

/**
 * The add-on's screens as routes beneath the signed-in layout (Console ADR
 * 0006 §2): each carries its sidebar entry as `staticData.nav`, so the shell
 * lists it in its view like any console screen, and the route's loader runs
 * the screen's `load`, so pending and error states are the console's own.
 */
export function addonScreenRoutes(screens: readonly AddonScreen[]): AnyRoute[] {
  return screens.map(({ path, nav, load, Screen }) => {
    const route = createRoute({
      getParentRoute: () => authedRoute,
      path,
      staticData: { nav },
      loader: load && (() => load()),
      component: function AddonScreenRoute() {
        const router = useRouter();
        return <Screen data={route.useLoaderData() as never} reload={() => router.invalidate()} />;
      },
    });
    return route;
  });
}

/**
 * Adds the add-on's screens to the signed-in layout's children. The file
 * routes are module singletons, so this runs once, before the first router is
 * built (`src/router.tsx`); a build whose add-on has no screens changes
 * nothing.
 */
export function mountAddonScreens(screens: readonly AddonScreen[] = []): void {
  if (screens.length === 0) return;
  const children = (authedRoute.children ?? []) as AnyRoute[];
  authedRoute.addChildren([...children, ...addonScreenRoutes(screens)]);
}

/**
 * The add-on's signed-out screens as routes at the root, beside `/login`
 * (Console ADR 0006 §2), which they follow: `?next=` sanitized against open
 * redirects, and a visitor already signed in sent on to it.
 */
export function addonSignedOutScreenRoutes(screens: readonly AddonSignedOutScreen[]): AnyRoute[] {
  return screens.map(({ path, Screen }) => {
    const route = createRoute({
      getParentRoute: () => rootRoute,
      path,
      validateSearch: (search: Record<string, unknown>): { next?: string } => ({
        next: sanitizeNextPath(stringParam(search.next)),
      }),
      beforeLoad: async ({ search }) => {
        // `next` is router-relative by construction; the cast widens the typed
        // `to` union for the dynamic value, as on `/login`.
        if (await fetchSession()) throw redirect({ to: (search.next ?? "/") as "/" });
      },
      component: function AddonSignedOutScreenRoute() {
        // The route is not in the router's types, so its search is what
        // `validateSearch` above returns.
        const { next } = route.useSearch() as { next?: string };
        return <Screen next={next} />;
      },
    });
    return route;
  });
}

/** Adds the add-on's signed-out screens to the root's children, as `mountAddonScreens` does. */
export function mountAddonSignedOutScreens(screens: readonly AddonSignedOutScreen[] = []): void {
  if (screens.length === 0) return;
  const children = (rootRoute.children ?? []) as AnyRoute[];
  rootRoute.addChildren([...children, ...addonSignedOutScreenRoutes(screens)]);
}
