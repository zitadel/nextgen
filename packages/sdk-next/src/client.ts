/**
 * Registers the `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>`
 * Lit web components for use in Next.js apps.
 *
 * Import this inside a `"use client"` boundary (e.g. a dynamic import
 * with `{ ssr: false }`) to register the custom elements with the
 * browser's global registry:
 *
 * ```ts
 * await import("@zitadel/sdk-next/client");
 * ```
 *
 * On an edge runtime the components package resolves to an entry without the
 * elements, so this entry still loads there. That is why the element classes
 * are exported as types only: a value export of a class would need the
 * elements entry.
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so
 * a consuming app that only declares `@zitadel/sdk-next` as a direct
 * dependency can configure the SDK without reaching into
 * `@zitadel/api/config` (which strict package managers would not
 * resolve). Call it inside the same `"use client"` boundary before the
 * components mount.
 */
import "@zitadel/components";

export type { ZitadelLogin, ZitadelLogout, ZitadelSession } from "@zitadel/components";
export { businessLocales } from "@zitadel/components";
export { configureZitadel, getApi } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
