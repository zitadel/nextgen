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
import { Activity, AppWindow, BarChart3, Folder } from "lucide-react";

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
 * Sidebar entries for screens that exist in the Figma mock but are not built
 * yet. Rendered identically to real entries (so the sidebar matches the design
 * pixel-for-pixel) but without a route, so they are not navigable.
 */
export const DESIGN_ONLY_NAV: NavMeta[] = [
  { label: "App groups", order: 3, icon: Folder },
  { label: "Applications", order: 4, icon: AppWindow },
  { label: "Analytics", order: 5, icon: BarChart3 },
  { label: "Activity Log", order: 7, icon: Activity },
];

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: NavMeta;
  }
}
