import type { AnyRoute } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

import { DESIGN_ONLY_NAV, type NavMeta } from "../../nav";

export interface NavItem {
  /** Route path, or `undefined` for design-only entries that are not built yet. */
  to: string | undefined;
  nav: NavMeta;
}

/**
 * Builds the flat sidebar list: built routes come from `staticData.nav` on the
 * route tree (Console ADR 0001), merged with the design-only entries that appear
 * in the Figma mock but have no route yet. The result is sorted by `nav.order`
 * so the sidebar matches the design regardless of route registration order.
 */
export function useNavItems(): NavItem[] {
  const router = useRouter();

  const routed = (Object.values(router.routesById) as AnyRoute[])
    .map((route) => {
      const nav = route.options.staticData?.nav;
      if (!nav) return undefined;
      const fullPath = route.fullPath;
      const to = fullPath === "/" ? "/" : fullPath.replace(/\/$/, "");
      return { to, nav } satisfies NavItem;
    })
    .filter((item): item is NavItem => item !== undefined);

  const designOnly: NavItem[] = DESIGN_ONLY_NAV.map((nav) => ({ to: undefined, nav }));

  return [...routed, ...designOnly].sort((a, b) => a.nav.order - b.nav.order);
}
