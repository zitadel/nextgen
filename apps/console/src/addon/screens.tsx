import { type AnyRoute, createRoute, useRouter } from "@tanstack/react-router";

import type { AddonScreen } from "@/addon/contract";
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
