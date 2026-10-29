import type { ComponentType, ReactNode } from "react";

/**
 * What an add-on gives the console (Console ADR 0006): the slots through which
 * code that only one deployment carries reaches it. The hosted cloud's console
 * build compiles in its own add-on, `apps/cloud-console`; every other build,
 * the one the Go server embeds included, the empty one in `./index.ts`. Every
 * slot is optional, so a new one costs the builds that leave it empty nothing.
 *
 * Add-ons import this file as `@zitadel/console/addon`, the console's only
 * export.
 */
export interface ConsoleAddon {
  /** Rendered once beside the routes, on every page: page-wide scripts such as analytics. */
  Root?: ComponentType<AddonPage>;
  /** Receives every custom event the console reports, as `src/lib/analytics.ts` types them. */
  track?: (
    event: string,
    properties: Readonly<Record<string, string | number | boolean | null>>,
  ) => void;
  /** Screens only this build has, beneath the signed-in shell (`AddonScreen`). */
  screens?: readonly AddonScreen[];
  /**
   * Where the sign-in widget (login, sign-up, claim) sends its calls instead of
   * the console's API base: a same-origin path that forwards them to the
   * server, as the hosted cloud's bot check does. Every other call stays direct.
   */
  signInApiBase?: `/${string}`;
}

/**
 * A screen the add-on adds beneath the signed-in layout, so the session guard
 * runs before it loads. Its sidebar entry is its route's, as every console
 * screen's is (Console ADR 0001): a build without the add-on has neither.
 */
export interface AddonScreen {
  /** The router-relative path: `/settings/billing`. One beneath `/settings` renders in the Settings view. */
  path: `/${string}`;
  /** Its entry in the sidebar its view names. */
  nav: AddonNav;
  /** Reads what the screen shows before it renders; a rejection renders the console's error state. */
  load?: () => Promise<unknown>;
  /** The screen, given what `load` resolved to; `never` admits a function component of any data. */
  Screen: (props: AddonScreenProps<never>) => ReactNode;
}

/** What the console renders an add-on screen with. */
export interface AddonScreenProps<Data> {
  data: Data;
  /** Runs `load` again, after the screen changed what it shows. */
  reload: () => Promise<void>;
}

/** A sidebar entry, as the console's `staticData.nav` holds one. */
export interface AddonNav {
  label: string;
  /** `settings` lists it in the Settings view's sidebar; `portal` beside the project's screens. */
  view: "portal" | "settings";
  /** Its place in that sidebar; the console's own entries start at 1. */
  order: number;
  /** A Lucide icon, or a component of the same shape. */
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean }>;
}

/** The page the console shows, as the add-on's `Root` is told it. */
export interface AddonPage {
  /** The document's path, deployment prefix included: `/console/users/user_123`. */
  path: string;
  /** The matched route, prefix included: `/console/users/$userId`. Unset until one matches. */
  route?: string;
  /** Whether the page is one of the signed-in shell's, past its session guard. */
  signedIn: boolean;
}
