/**
 * The browser entry of the Qwik Router SDK.
 *
 * This entry carries only the project configuration helpers ({@link configureZitadel},
 * {@link getApi}, {@link getZitadelConfig}). They are re-exported so an app that declares
 * `@zitadel/sdk-qwik-router` as its only direct dependency can configure the SDK without
 * a second package. It contains no server code and no secrets, so it is safe in a
 * browser bundle. The `<ZitadelLogin>` and `<ZitadelLogout>` Qwik components come from
 * `@zitadel/sdk-qwik-router/components`, which re-exports `@zitadel/sdk-qwik`, not from here.
 *
 * @example
 * ```ts
 * import { configureZitadel } from "@zitadel/sdk-qwik-router/client";
 *
 * configureZitadel({ url: "https://auth.example.com", projectId: "123456789" });
 * ```
 *
 * @module
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
