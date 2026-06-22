/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in SvelteKit apps.
 *
 * Import this inside a browser-only boundary (e.g. an `onMount` callback or a
 * `+page.svelte` guarded by `browser` from `$app/environment`) to register the
 * custom elements with the browser's global registry:
 *
 * ```ts
 * import { browser } from "$app/environment";
 * import { onMount } from "svelte";
 *
 * onMount(async () => {
 *   if (browser) await import("@zitadel/sdk-sveltekit/client");
 * });
 * ```
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so a
 * consuming app that only declares `@zitadel/sdk-sveltekit` as a direct
 * dependency can configure the SDK without reaching into `@zitadel/api/config`
 * (which strict package managers would not resolve). Call it in the same
 * browser-only boundary before the components mount.
 */
export { ZitadelLogin, ZitadelLogout } from "@zitadel/components";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
