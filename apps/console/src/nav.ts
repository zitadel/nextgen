/**
 * Navigation metadata for the sidebar.
 *
 * Built routes attach their entry via `staticData` (Console ADR 0001) so the
 * sidebar stays in sync with the route tree — every row in the sidebar is a
 * screen that exists.
 */
import type { NavIcon } from "./components/app-shell/icons";

/**
 * Which sidebar an entry belongs to. The shell renders one of two navs from the
 * same route tree, so an entry has to say which: without it every Settings
 * screen would also appear in the portal's primary list.
 */
export type NavView = "portal" | "settings";

export interface NavMeta {
  /** Sidebar label. */
  label: string;
  /** Which sidebar this entry belongs to. Defaults to the portal list. */
  view?: NavView;
  /** Sort order in the sidebar, which is one level. */
  order: number;
  /** Sidebar glyph (matches the design system's Lucide icon set). */
  icon: NavIcon;
}

/**
 * Sidebar entries for designed screens that are not built.
 *
 * **Empty on purpose.** The sidebar lists only screens that work: a disabled
 * row reads as "your account cannot do this".
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
