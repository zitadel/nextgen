/**
 * Client-side SDK configuration for SolidStart apps.
 *
 * The idiomatic `<ZitadelLogin>` / `<ZitadelLogout>` Solid components now ship
 * from `@zitadel/sdk-solid`; this entrypoint exposes only the configuration
 * helpers. SDK configuration is done via `configureZitadel()`, re-exported here
 * so a consuming app that only declares `@zitadel/sdk-solid-start` as a direct
 * dependency can configure the SDK without reaching into `@zitadel/api/config`.
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
