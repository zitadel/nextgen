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
 * Which sidebar list an entry belongs to. The shell renders one list at a
 * time from the same route tree, so an entry has to say which: `portal` is
 * the selected project's screens, `account` what sits above every project
 * (Projects, and Settings; the sidebar lists the project's among them,
 * `accountListItems`), `settings` the pages Settings opens (the person's
 * profile, what an add-on adds beside it).
 *
 * `logs` is the list Logs opens, in place of the project's (D30). No route
 * belongs to it: its rows are the views and filters of one screen, which the
 * events feature draws (`LogViewRows`, `LogFilters`).
 */
export type NavView = "portal" | "account" | "settings" | "logs";

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
