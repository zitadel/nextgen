/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in SolidStart apps.
 *
 * Import this inside a browser-only boundary (e.g. an `onMount` callback) to
 * register the custom elements with the browser's global registry:
 *
 * ```ts
 * import { onMount } from "solid-js";
 * import { isServer } from "solid-js/web";
 *
 * onMount(async () => {
 *   if (!isServer) await import("@zitadel/sdk-solid-start/client");
 * });
 * ```
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so a
 * consuming app that only declares `@zitadel/sdk-solid-start` as a direct
 * dependency can configure the SDK without reaching into `@zitadel/api/config`.
 */
export { ZitadelLogin, ZitadelLogout } from "@zitadel/components";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
