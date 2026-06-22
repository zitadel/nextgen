/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in TanStack Start apps.
 *
 * Prefer the typed React wrappers from `@zitadel/sdk-tanstack-start/react`. This
 * client entry registers the raw custom elements and re-exports
 * `configureZitadel()` so a consuming app that only declares
 * `@zitadel/sdk-tanstack-start` as a direct dependency can configure the SDK
 * without reaching into `@zitadel/api/config`. Import it inside a client-only
 * boundary before the components mount.
 */
export { ZitadelLogin, ZitadelLogout } from "@zitadel/components";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
