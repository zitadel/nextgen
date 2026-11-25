/**
 * Re-exports the API configuration helpers for the browser side of a SvelteKit app.
 *
 * The login and logout widgets are the Svelte components that `@zitadel/sdk-sveltekit/components`
 * re-exports from `@zitadel/sdk-svelte`. This entry only re-exports {@link configureZitadel} so that an app
 * can configure the SDK from the one package it depends on, which strict package managers
 * require. Call it before the widget mounts, for example in `+page.svelte`.
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
