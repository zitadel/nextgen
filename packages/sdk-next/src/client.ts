/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in Next.js apps.
 *
 * Import this inside a `"use client"` boundary (e.g. a dynamic import
 * with `{ ssr: false }`) to register the custom elements with the
 * browser's global registry:
 *
 * ```ts
 * await import("@zitadel/sdk-next/client");
 * ```
 *
 * SDK configuration is handled separately via `configureZitadel()`
 * from `@zitadel/api/config` — typically in a shared
 * `zitadel.ts` init file.
 */
export { ZitadelLogin, ZitadelLogout } from '@zitadel/components';
