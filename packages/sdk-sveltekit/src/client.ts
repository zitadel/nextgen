/**
 * Client-side SDK configuration for SvelteKit apps.
 *
 * The login/logout widgets are the idiomatic Svelte components from
 * `@zitadel/sdk-svelte` (`ZitadelLogin` / `ZitadelLogout`) — this server SDK no
 * longer ships them. This entry just re-exports `configureZitadel()` so a
 * consuming app can configure the SDK without depending on `@zitadel/api/config`
 * directly (which strict package managers would not resolve). Call it before the
 * widget mounts, e.g. in `+page.svelte`.
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
