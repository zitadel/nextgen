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
 * elements, so this entry still loads there.
 *
 * SDK configuration is done via `configureZitadel()`, re-exported here so
 * a consuming app that only declares `@zitadel/sdk-next` as a direct
 * dependency can configure the SDK without reaching into
 * `@zitadel/api/config` (which strict package managers would not
 * resolve). Call it inside the same `"use client"` boundary before the
 * components mount.
 */
// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
// The edge build of the components package has no elements, so this does nothing there.
import "@zitadel/components";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
export { configureZitadel, getApi } from "@zitadel/api/config";
export type { ZitadelConfig, ZitadelProject } from "@zitadel/api/config";
