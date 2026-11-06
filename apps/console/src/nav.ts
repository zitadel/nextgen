/**
 * Navigation metadata for the sidebar.
 *
 * Built routes attach their entry via `staticData` (Console ADR 0001) so the
 * sidebar stays in sync with the route tree — every row in the sidebar is a
 * screen that exists.
 */
import type { ComponentType } from "react";

/** A sidebar glyph. Lucide icons satisfy this. */
export type NavIcon = ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean;
}>;

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

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: NavMeta;
  }
}
