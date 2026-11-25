/**
 * The client-side configuration entry for TanStack Start apps.
 *
 * The sign-in, sign-out and session widgets are the React components from
 * `@zitadel/sdk-tanstack-start/react`. This entry re-exports {@link configureZitadel} so that an
 * app which declares only `@zitadel/sdk-tanstack-start` as a direct dependency can configure the
 * SDK without depending on `@zitadel/api/config`, which a strict package manager would not
 * resolve. Like the `/client` entry of the other meta-framework SDKs, it exports no element
 * classes, so an auto-import of `ZitadelLogin` cannot pick a web component class in place of the
 * React component.
 *
 * @example
 * ```ts
 * import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";
 *
 * export const project = configureZitadel({ projectId: "demo", proxyPath: "/__nextgen" });
 * ```
 *
 * @module
 */
export { configureZitadel, getApi, getZitadelConfig } from "@zitadel/sdk-core/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/sdk-core/config";
