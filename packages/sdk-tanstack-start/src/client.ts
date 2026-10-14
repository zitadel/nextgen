/**
 * Client-side SDK configuration for TanStack Start apps.
 *
 * The login/logout/session widgets are the React components from
 * `@zitadel/sdk-tanstack-start/react`. This entry just re-exports
 * `configureZitadel()` so a consuming app that only declares
 * `@zitadel/sdk-tanstack-start` as a direct dependency can configure the SDK
 * without depending on `@zitadel/api/config` directly (which strict package
 * managers would not resolve). Like the other meta-framework SDKs' `/client`,
 * it exports no element classes, so an auto-import of `ZitadelLogin` cannot
 * pick a Lit class in place of the React component.
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
