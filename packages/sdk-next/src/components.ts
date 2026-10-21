"use client";

/**
 * React components for the Zitadel widgets in Next.js apps.
 *
 * Use these instead of the raw `<zitadel-login>`, `<zitadel-logout>` and
 * `<zitadel-session>` elements: the wrappers set `project` and `locales` as DOM
 * properties on React 18 and 19, including after server-rendered hydration,
 * where the raw elements lose them (React 19) or write `[object Object]`
 * attributes (React 18).
 *
 * ```tsx
 * import { ZitadelLogin } from "@zitadel/sdk-next/components";
 * ```
 */
export {
  businessLocales,
  configureZitadel,
  ZitadelLogin,
  ZitadelLogout,
  ZitadelSession,
} from "@zitadel/sdk-react";
export type {
  ZitadelLoginReactProps,
  ZitadelLogoutReactProps,
  ZitadelSessionReactProps,
} from "@zitadel/sdk-react";
