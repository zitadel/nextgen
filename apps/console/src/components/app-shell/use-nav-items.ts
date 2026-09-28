import type { AnyRoute } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

import { DESIGN_ONLY_NAV, type NavMeta, type NavView } from "../../nav";

export interface NavItem {
  /** Route path, or `undefined` for design-only entries that are not built yet. */
  to: string | undefined;
  nav: NavMeta;
  /** Entries nested under this one (`nav.parent === this.to`). */
  children: SubNavItem[];
}

/**
 * A nested entry. Always routed: `DESIGN_ONLY_NAV` has no screen behind it, and
 * a disabled row is doubly misleading one level in — it reads as a section of a
 * feature that does not exist. Those stay at the top level.
 */
export interface SubNavItem extends NavItem {
  to: string;
}

/**
 * Builds one sidebar's list: built routes come from `staticData.nav` on the
 * route tree (Console ADR 0001), merged with the design-only entries that
 * appear in the Figma mock but have no route yet.
 *
 * `view` selects which sidebar. The shell renders two from one route tree, so
 * an entry belongs to exactly one of them. Each level is sorted by `nav.order` so
 * the sidebar matches the design regardless of route registration order.
 *
 * Entries carrying `nav.parent` are nested one level beneath the entry with
 * that path — `User schemas` under `Users` in the `Schema directory` frame. A
 * child whose parent is not in the list falls back to the top level rather than
 * disappearing: an orphan is a routing mistake, and hiding the screen entirely
 * is the worse failure.
 */
export function useNavItems(view: NavView = "portal"): NavItem[] {
  const router = useRouter();

  const routed = (Object.values(router.routesById) as AnyRoute[])
    .map((route): NavItem | undefined => {
      const nav = route.options.staticData?.nav;
      // `view` defaults to the portal list so the existing screens, none of
      // which declare one, keep their place.
      if (!nav || (nav.view ?? "portal") !== view) return undefined;
      const fullPath = route.fullPath;
      const to = fullPath === "/" ? "/" : fullPath.replace(/\/$/, "");
      return { to, nav, children: [] };
    })
    .filter((item): item is NavItem => item !== undefined);

  // Design-only entries are portal rows; the Settings view has none.
  const designOnly: NavItem[] =
    view === "portal"
      ? DESIGN_ONLY_NAV.map((nav) => ({ to: undefined, nav, children: [] }))
      : [];

  const all: NavItem[] = [...routed, ...designOnly];
  const byPath = new Map<string, NavItem>();
  for (const item of all) {
    if (item.to) byPath.set(item.to, item);
  }

  const top: NavItem[] = [];
  for (const item of all) {
    const parent = item.nav.parent && item.to ? byPath.get(item.nav.parent) : undefined;
    if (parent && parent !== item) parent.children.push(item as SubNavItem);
    else top.push(item);
  }

  const byOrder = (a: NavItem, b: NavItem) => a.nav.order - b.nav.order;
  for (const item of top) item.children.sort(byOrder);
  return top.sort(byOrder);
}
