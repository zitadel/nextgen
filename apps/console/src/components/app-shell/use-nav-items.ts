import type { AnyRoute } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

import { DESIGN_ONLY_NAV, type NavMeta, SETTINGS_GROUPS } from "../../nav";

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

/** One Settings-view group with at least one built screen under it. */
export interface SettingsNavGroup {
  section: string;
  /** Rendered group heading (`Account`, `Workspace`). */
  label: string;
  items: SubNavItem[];
}

/** Every route carrying a `staticData.nav` entry (Console ADR 0001). */
function routedNavItems(routes: AnyRoute[]): NavItem[] {
  return routes
    .map((route): NavItem | undefined => {
      const nav = route.options.staticData?.nav;
      if (!nav) return undefined;
      const fullPath = route.fullPath;
      const to = fullPath === "/" ? "/" : fullPath.replace(/\/$/, "");
      return { to, nav, children: [] };
    })
    .filter((item): item is NavItem => item !== undefined);
}

const byOrder = (a: NavItem, b: NavItem) => a.nav.order - b.nav.order;

/**
 * Builds the Portal sidebar list: built routes come from `staticData.nav` on
 * the route tree (Console ADR 0001), merged with the design-only entries that
 * appear in the Figma mock but have no route yet. Each level is sorted by
 * `nav.order` so the sidebar matches the design regardless of route
 * registration order.
 *
 * Entries carrying `nav.section` belong to the Settings view and are excluded
 * here — {@link useSettingsNavItems} is their list.
 *
 * Entries carrying `nav.parent` are nested one level beneath the entry with
 * that path — `User schemas` under `Users` in the `Schema directory` frame. A
 * child whose parent is not in the list falls back to the top level rather than
 * disappearing: an orphan is a routing mistake, and hiding the screen entirely
 * is the worse failure.
 */
export function useNavItems(): NavItem[] {
  const router = useRouter();

  const routed = routedNavItems(Object.values(router.routesById) as AnyRoute[]).filter(
    (item) => !item.nav.section,
  );

  const designOnly: NavItem[] = DESIGN_ONLY_NAV.map((nav) => ({
    to: undefined,
    nav,
    children: [],
  }));

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

  for (const item of top) item.children.sort(byOrder);
  return top.sort(byOrder);
}

/**
 * Builds the Settings sidebar: routed entries carrying `nav.section`, grouped
 * under `SETTINGS_GROUPS` in design order (`ACCOUNT`, `WORKSPACE` — Figma
 * `1568:97804`) and sorted by `nav.order` within a group. Groups with nothing
 * under them are dropped rather than rendered as empty headings, and there are
 * no design-only entries here — the Settings view lists only screens that work,
 * for the same reason the portal list does.
 */
export function useSettingsNavItems(): SettingsNavGroup[] {
  const router = useRouter();

  const routed = routedNavItems(Object.values(router.routesById) as AnyRoute[]).filter(
    (item): item is SubNavItem => !!item.nav.section && !!item.to,
  );

  return SETTINGS_GROUPS.map(({ section, label }) => ({
    section,
    label,
    items: routed.filter((item) => item.nav.section === section).sort(byOrder),
  })).filter((group) => group.items.length > 0);
}
