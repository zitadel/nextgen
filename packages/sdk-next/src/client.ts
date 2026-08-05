/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in Next.js apps.
 *
 * Import this inside a `"use client"` boundary (e.g. a dynamic import
 * with `{ ssr: false }`) to register the custom elements with the
 * browser's global registry:
 *
 * ```ts
 * await import("@zitadel/sdk-next/client");
 * ```
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so
 * a consuming app that only declares `@zitadel/sdk-next` as a direct
 * dependency can configure the SDK without reaching into
 * `@zitadel/api/config` (which strict package managers would not
 * resolve). Call it inside the same `"use client"` boundary before the
 * components mount.
 */
export { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/components";
export { configureZitadel, getApi } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
