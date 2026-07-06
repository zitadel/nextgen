import type { AnyRoute } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

import type { NavGroup, NavMeta } from "../../nav";
import { NAV_GROUP_ORDER } from "../../nav";

export interface NavItem {
  to: string;
  nav: NavMeta;
}

export interface NavSection {
  /** `null` for the ungrouped, top-of-sidebar items (e.g. Dashboard). */
  group: NavGroup | null;
  items: NavItem[];
}

/**
 * Builds the sidebar sections by reading `staticData.nav` off the route tree
 * (Console ADR 0001). Routes without nav metadata are ignored, so adding a
 * navigable route is all it takes to add a sidebar entry.
 */
export function useNavSections(): NavSection[] {
  const router = useRouter();

  const items: NavItem[] = (Object.values(router.routesById) as AnyRoute[])
    .map((route) => {
      const nav = route.options.staticData?.nav;
      if (!nav) return undefined;
      const fullPath = route.fullPath;
      const to = fullPath === "/" ? "/" : fullPath.replace(/\/$/, "");
      return { to, nav } satisfies NavItem;
    })
    .filter((item): item is NavItem => item !== undefined)
    .sort((a, b) => a.nav.order - b.nav.order);

  const sections: NavSection[] = [];

  const ungrouped = items.filter((item) => !item.nav.group);
  if (ungrouped.length > 0) sections.push({ group: null, items: ungrouped });

  for (const group of NAV_GROUP_ORDER) {
    const groupItems = items.filter((item) => item.nav.group === group);
    if (groupItems.length > 0) sections.push({ group, items: groupItems });
  }

  return sections;
}
