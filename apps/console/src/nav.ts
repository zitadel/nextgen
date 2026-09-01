/**
 * Navigation metadata for the Figma sidebar. The shell has two views: Portal
 * (a single flat list, no group headings; order is driven by `order`) and
 * Settings (grouped under the frames' `ACCOUNT` / `WORKSPACE` headings —
 * `section` below decides membership).
 *
 * Built routes attach their entry via `staticData` (Console ADR 0001) so the
 * sidebar stays in sync with the route tree — every row in the sidebar is a
 * screen that exists.
 */
import type { NavIcon } from "./components/app-shell/icons";

/** Settings-view group ids — the frames' `ACCOUNT` / `WORKSPACE` headings. */
export type SettingsSection = (typeof SETTINGS_GROUPS)[number]["section"];

/**
 * The settings groups in design order (Figma `1568:97804`), with the headings
 * the sidebar renders. A group with no built screen under it is not drawn —
 * same argument as `DESIGN_ONLY_NAV` below: a heading over nothing advertises
 * a section that does not exist.
 */
export const SETTINGS_GROUPS = [
  { section: "account", label: "Account" },
  { section: "workspace", label: "Workspace" },
] as const;

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
  /**
   * Settings-view group this entry renders under. Present = the entry belongs
   * to the Settings sidebar (grouped, `SETTINGS_GROUPS` order); absent = the
   * entry is Portal chrome. The shell filters on this, so a settings route
   * never leaks into the portal list and vice versa — `app-shell.spec`'s exact
   * portal-order assertion is the guard.
   */
  section?: SettingsSection;
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
