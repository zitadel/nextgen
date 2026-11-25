/**
 * The browser-safe entry point of the SolidStart SDK, which exposes only the API configuration
 * helpers.
 *
 * Import from this entry when code that may be bundled for the browser needs the typed API client
 * but must not pull in the request middleware. The sign-in and sign-out widgets come from
 * `@zitadel/sdk-solid-start/components`, which re-exports `@zitadel/sdk-solid`. {@link configureZitadel} is re-exported here so an app that declares
 * `@zitadel/sdk-solid-start` as its only direct dependency can configure the SDK without
 * a second package.
 *
 * @module
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
