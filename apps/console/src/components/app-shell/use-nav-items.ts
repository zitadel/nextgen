import type { AnyRoute } from "@tanstack/react-router";
import { useMatch, useRouter, useSearch } from "@tanstack/react-router";

import { withoutTrailingSlash } from "@/lib/project-scope";
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
 * Screens declaring `staticData.scope: "project"` are listed whether or not a
 * project is selected (D22): without one, the `_authed` guard sends such a
 * screen to Projects to choose one first (`?next=`), and choosing one goes on
 * to it. Links need not carry the selection — the `_authed` layout retains it.
 */
export function useNavItems(view: NavView = "portal"): NavItem[] {
  const router = useRouter();

  const routed = (Object.values(router.routesById) as AnyRoute[])
    .map((route): NavItem | undefined => {
      const nav = route.options.staticData?.nav;
      // `view` defaults to the portal list so the existing screens, none of
      // which declare one, keep their place.
      if (!nav || (nav.view ?? "portal") !== view) return undefined;
      const to = withoutTrailingSlash(route.fullPath);
      return { to, nav };
    })
    .filter((item): item is NavItem => item !== undefined);

  // Design-only entries are portal rows; the Settings view has none.
  const designOnly: NavItem[] =
    view === "portal" ? DESIGN_ONLY_NAV.map((nav) => ({ to: undefined, nav })) : [];

  return [...routed, ...designOnly].sort((a, b) => a.nav.order - b.nav.order);
}

/**
 * The entry a screen was opened from while Projects asks for a project first:
 * the one `?next=` names on Projects (`/teams?status=…` → Teams, and a screen
 * beneath an entry, `/users/usr_1`, → Users). The sidebar marks it and the page
 * names it, as the person asked for that screen rather than for Projects.
 * `undefined` anywhere else, and for a `next` no entry holds.
 */
export function useRequestedNavItem(items: NavItem[]): NavItem | undefined {
  const onProjects = useMatch({ from: "/_authed/projects/", shouldThrow: false });
  const next = useSearch({ strict: false, select: (search) => search.next });
  if (!onProjects || !next) return undefined;
  // `next` is router-relative and sanitized on the way in (`sanitizeNextPath`).
  const { pathname } = new URL(next, "http://console.invalid");
  return navItemFor(items, pathname);
}

/**
 * The entry a path is, or sits beneath: `/users/usr_1` → Users. The longest
 * match, so an entry nested under another is not taken for it.
 */
export function navItemFor(items: NavItem[], path: string): NavItem | undefined {
  let match: NavItem | undefined;
  for (const item of items) {
    const { to } = item;
    if (!to || to === "/" || (path !== to && !path.startsWith(`${to}/`))) continue;
    if (!match?.to || to.length > match.to.length) match = item;
  }
  return match;
}
