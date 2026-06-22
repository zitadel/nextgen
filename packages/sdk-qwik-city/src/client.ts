/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in Qwik City apps.
 *
 * Register the custom elements in a browser-only boundary (e.g. inside a
 * `useVisibleTask$` or a client-only dynamic import) before they mount:
 *
 * ```ts
 * useVisibleTask$(async () => {
 *   const { configureZitadel } = await import('@zitadel/sdk-qwik-city/client');
 *   configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });
 *   await import('@zitadel/sdk-qwik-city/client');
 * });
 * ```
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so a
 * consuming app that only declares `@zitadel/sdk-qwik-city` as a direct
 * dependency can configure the SDK without reaching into `@zitadel/api/config`.
 */
export { ZitadelLogin, ZitadelLogout } from "@zitadel/components";
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
