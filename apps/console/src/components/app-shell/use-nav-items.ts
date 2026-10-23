import type { AnyRoute } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

import { useProjectScope, withoutTrailingSlash } from "@/lib/project-scope";
import { DESIGN_ONLY_NAV, type NavMeta, type NavView } from "@/nav";

export interface NavItem {
  /** Route path, or `undefined` for design-only entries that are not built yet. */
  to: string | undefined;
  nav: NavMeta;
}

/**
 * Builds one sidebar's list: built routes come from `staticData.nav` on the
 * route tree (Console ADR 0001), merged with the design-only entries
 * (`DESIGN_ONLY_NAV`, empty today).
 *
 * `view` selects which sidebar. The shell renders two from one route tree, so
 * an entry belongs to exactly one of them. The list is one level, sorted by
 * `nav.order` so the sidebar matches the design regardless of route
 * registration order.
 *
 * Screens declaring `staticData.scope: "project"` are listed only while a
 * project is selected (`src/lib/project-scope.ts`): without one they have
 * nothing to show, and the Projects screen is where the selection is made.
 * Links need not carry the selection — the `_authed` layout retains it.
 */
export function useNavItems(view: NavView = "portal"): NavItem[] {
  const router = useRouter();
  const projectScope = useProjectScope();

  const routed = (Object.values(router.routesById) as AnyRoute[])
    .map((route): NavItem | undefined => {
      const nav = route.options.staticData?.nav;
      // `view` defaults to the portal list so the existing screens, none of
      // which declare one, keep their place.
      if (!nav || (nav.view ?? "portal") !== view) return undefined;
      if (route.options.staticData?.scope === "project" && !projectScope) return undefined;
      const to = withoutTrailingSlash(route.fullPath);
      return { to, nav };
    })
    .filter((item): item is NavItem => item !== undefined);

  // Design-only entries are portal rows; the Settings view has none.
  const designOnly: NavItem[] =
    view === "portal" ? DESIGN_ONLY_NAV.map((nav) => ({ to: undefined, nav })) : [];

  return [...routed, ...designOnly].sort((a, b) => a.nav.order - b.nav.order);
}
