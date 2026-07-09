/**
 * Navigation metadata attached to routes via `staticData` (Console ADR 0001).
 *
 * The sidebar is built by reading this metadata off the route tree, so adding
 * a navigable route automatically adds its nav entry — there is no separate
 * nav list to keep in sync.
 */
export type NavGroup = "Identity" | "Configuration";

export interface NavMeta {
  /** Group heading. Items without a group render at the top (e.g. Dashboard). */
  group?: NavGroup;
  /** Sidebar label. */
  label: string;
  /** Sort order within the group (and among ungrouped items). */
  order: number;
}

/** Order the groups render in. */
export const NAV_GROUP_ORDER: NavGroup[] = ["Identity", "Configuration"];

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: NavMeta;
  }
}
