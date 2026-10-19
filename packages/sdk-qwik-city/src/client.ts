/**
 * Client-side SDK configuration for Qwik City apps.
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so a
 * consuming app that only declares `@zitadel/sdk-qwik-city` as a direct
 * dependency can configure the SDK without reaching into `@zitadel/api/config`.
 * The idiomatic `<ZitadelLogin>` / `<ZitadelLogout>` Qwik components live in
 * `@zitadel/sdk-qwik`.
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
