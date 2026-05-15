/**
 * Re-exports the `<zitadel-login>` and `<zitadel-logout>` Lit web components
 * for use in Next.js apps.
 *
 * Import this inside a `"use client"` boundary to register the custom
 * elements with the global registry:
 *
 * ```ts
 * "use client";
 * import "@zitadel-nextgen/sdk-next/client";
 * ```
 */
export { ZitadelLogin, ZitadelLogout } from '@zitadel-nextgen/components';
