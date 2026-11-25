/**
 * Re-exports the API configuration helpers for the browser side of a SvelteKit app.
 *
 * The login and logout widgets are the Svelte components from `@zitadel/sdk-svelte`, which this
 * server SDK does not ship. This entry only re-exports {@link configureZitadel} so that an app
 * can configure the SDK without depending on `@zitadel/api/config` directly, which strict package
 * managers do not resolve. Call it before the widget mounts, for example in `+page.svelte`.
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
