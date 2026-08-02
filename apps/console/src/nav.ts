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
  /** Sort order in the flat sidebar list. */
  order: number;
  /** Sidebar glyph (matches the design system's Lucide icon set). */
  icon: NavIcon;
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
 * import { Activity, AppWindow, BarChart3, Folder } from "lucide-react";
 *
 * export const DESIGN_ONLY_NAV: NavMeta[] = [
 *   { label: "App groups", order: 3, icon: Folder },
 *   { label: "Applications", order: 4, icon: AppWindow },
 *   { label: "Analytics", order: 5, icon: BarChart3 },
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
