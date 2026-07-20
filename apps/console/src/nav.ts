/**
 * Navigation metadata for the Figma admin sidebar (a single flat list, no group
 * headings; order is driven by `order`).
 *
 * Built routes attach their entry via `staticData` (Console ADR 0001) so the
 * sidebar stays in sync with the route tree. The design's sidebar also shows
 * screens that are not built yet; those are listed in `DESIGN_ONLY_NAV` so the
 * shell can render the full, pixel-accurate mock while marking un-built
 * destinations as non-navigable.
 */
import { Activity, ChartLine, Folder, LayoutGrid, Settings, Zap } from "lucide-react";

import { type NavIcon, UserRoundArrowLeft } from "./components/app-shell/icons";

export interface NavMeta {
  /** Sidebar label. */
  label: string;
  /** Sort order in the flat sidebar list. */
  order: number;
  /** Sidebar glyph (matches the design system's Lucide icon set). */
  icon: NavIcon;
  /**
   * Optional right-aligned count badge. In the mock these are the designed
   * placeholder totals; real screens can override with a live count later.
   */
  count?: string;
}

/**
 * Sidebar entries for screens that exist in the Figma mock but are not built
 * yet. Rendered identically to real entries (so the sidebar matches the design
 * pixel-for-pixel) but without a route, so they are not navigable.
 */
export const DESIGN_ONLY_NAV: NavMeta[] = [
  { label: "App groups", order: 3, icon: Folder, count: "10,000" },
  { label: "Applications", order: 4, icon: LayoutGrid, count: "10,000" },
  { label: "Actions", order: 5, icon: Zap },
  { label: "Role assignments", order: 6, icon: UserRoundArrowLeft },
  { label: "Analytics", order: 7, icon: ChartLine },
  { label: "Activity Log", order: 9, icon: Activity },
  { label: "Manage team", order: 10, icon: Settings },
];

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: NavMeta;
  }
}
