import type { AnyRoute } from "@tanstack/react-router";
import { useMatch, useRouter, useSearch } from "@tanstack/react-router";

import { withoutTrailingSlash } from "@/lib/base-path";
import type { NavMeta, NavView } from "@/nav";

/** Route prefix of the selected project's Settings, whose pages have a list of their own (D40). */
export const PROJECT_SETTINGS_PATH = "/project";

export interface NavItem {
  /** Route path. */
  to: string;
  nav: NavMeta;
}

/**
 * Builds one sidebar's list from `staticData.nav` on the route tree (Console
 * ADR 0001).
 *
 * `view` selects which list. The shell renders several from one route tree, so
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

  return (Object.values(router.routesById) as AnyRoute[])
    .map((route): NavItem | undefined => {
      const nav = route.options.staticData?.nav;
      // `view` defaults to the portal list so the existing screens, none of
      // which declare one, keep their place.
      if (!nav || (nav.view ?? "portal") !== view) return undefined;
      const to = withoutTrailingSlash(route.fullPath);
      return { to, nav };
    })
    .filter((item): item is NavItem => item !== undefined)
    .sort((a, b) => a.nav.order - b.nav.order);
}

/**
 * The account list as the sidebar draws it (D34): its first row, Projects,
 * then the project's screens, then the account's other rows (Settings). Above
 * every project the account's rows alone left the sidebar nearly empty; with
 * the project's screens it shows what the console holds. Choosing one opens it
 * in the selected project (D36), and asks for a project first when none is
 * (D31).
 *
 * Two of the project's rows are left out, as in Vercel. Its landing, `/`
 * (Overview, D35), is the row Projects stands in for up here. A screen named
 * like an account row (the project's own Settings) would name two places
 * alike: up here Settings is the account's.
 */
export function accountListItems(account: NavItem[], project: NavItem[]): NavItem[] {
  const [home, ...rest] = account;
  const taken = new Set(account.map((item) => item.nav.label));
  const screens = project.filter((item) => item.to !== "/" && !taken.has(item.nav.label));
  return home ? [home, ...screens, ...rest] : screens;
}

/**
 * The entry a screen was opened from while Projects asks for a project first:
 * the one `?next=` names on Projects (`/teams?status=…` → Teams, and a screen
 * beneath an entry, `/users/usr_1`, → Users). The page names it, as the person
 * asked for that screen rather than for Projects.
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
    if (to === "/" || (path !== to && !path.startsWith(`${to}/`))) continue;
    if (!match || to.length > match.to.length) match = item;
  }
  return match;
}
