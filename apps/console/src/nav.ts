/**
 * Navigation metadata for the Figma admin sidebar (a single flat list, no group
 * headings; order is driven by `order`).
 *
 * Built routes attach their entry via `staticData` (Console ADR 0001) so the
 * sidebar stays in sync with the route tree — every row in the sidebar is a
 * screen that exists.
 */
import type { NavIcon } from "./components/app-shell/icons";

export interface NavMeta {
  /** Sidebar label. */
  label: string;
  /** Sort order among siblings (top level, or within one parent's children). */
  order: number;
  /**
   * Sidebar glyph (matches the design system's Lucide icon set). Optional
   * because a nested entry renders as text — the design's
   * `Sidebar / SidebarMenuSubItem` carries no icon, so a nested entry that
   * declared one would be dead data.
   */
  icon?: NavIcon;
  /**
   * Route path of the entry this one nests under, e.g. `"/users"` for
   * `User schemas`. Nested entries render in shadcn's `SidebarMenuSub` beneath
   * the parent — the design's `Sidebar / SidebarMenuSub` frame — and are hidden
   * with it when the sidebar collapses to the icon rail.
   *
   * Matched on the parent's path rather than its label so renaming a label does
   * not silently orphan the child.
   */
  parent?: string;
}

/**
 * Sidebar entries for screens in the Figma mock that are not built.
 *
 * **Empty on purpose.** These used to render as disabled rows so the sidebar
 * matched the design pixel-for-pixel — but a disabled row still advertises a
 * feature. It reads as "your account cannot do this" rather than "this does not
 * exist", and four of the seven nav items were permanently inert. The sidebar
 * now lists only screens that work, so a gap reads as a gap.
 *
 * Restore an entry when its screen has an endpoint behind it. None does today:
 *
 *   - App groups   — needs ADR 034's app-group catalog (epic #419)
 *   - Applications — no application resource or endpoints exist
 *   - Analytics    — no aggregate or time-series endpoint exists
 *   - Activity Log — no audit-log read API (#350)
 *
 * ```ts
 * import { Activity, AppWindow, Folder, LineChart } from "lucide-react";
 *
 * export const DESIGN_ONLY_NAV: NavMeta[] = [
 *   { label: "App groups", order: 3, icon: Folder },
 *   { label: "Applications", order: 4, icon: AppWindow },
 *   { label: "Analytics", order: 5, icon: LineChart },
 *   { label: "Activity Log", order: 7, icon: Activity },
 * ];
 * ```
 */
export const DESIGN_ONLY_NAV: NavMeta[] = [];

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: NavMeta;
  }
}
