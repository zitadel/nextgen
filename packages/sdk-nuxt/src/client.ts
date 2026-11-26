/**
 * The browser-side configuration of `@zitadel/sdk-nuxt`: the project handle and the typed API
 * client.
 *
 * These are the same helpers that every other SDK exports from its client entry, re-exported from
 * `@zitadel/sdk-core/config` so that an app wires the project the same way in every framework.
 * {@link configureZitadel} registers the project once and returns the frozen handle,
 * {@link getZitadelConfig} reads it back and {@link getApi} returns the typed API client bound to
 * the same-origin proxy path.
 *
 * Inside a Nuxt app the module already reads the `zitadel` runtime configuration and provides the
 * handle through `useZitadelProject()`. Use this entry only in code that runs outside that
 * composable, for example a plain module or a test.
 *
 * @example
 * ```ts
 * import { configureZitadel, getApi } from "@zitadel/sdk-nuxt/client";
 *
 * const project = configureZitadel({ projectId: "…" });
 * const api = getApi(project);
 * ```
 *
 * @module
 */

export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
