/**
 * The server-side entry of `@zitadel/sdk-next`, for Server Components, Route Handlers and other
 * server modules.
 *
 * It exposes {@link auth}, which reads and verifies the session during a render, and
 * {@link ZitadelProvider}, which seeds client components with the token-less session. Both import
 * the `server-only` guard, so pulling this entry into a `"use client"` module graph fails the
 * build instead of shipping the session token to the browser. That failure is intentional: the
 * token that {@link auth} returns must never become client state.
 *
 * The middleware is not exported from here on purpose. It belongs in the `proxy.ts` file
 * (`middleware.ts` on Next.js 15) and imports from `@zitadel/sdk-next/middleware`, which keeps that
 * file free of the `server-only` guard that this entry carries.
 *
 * Client Components do not import from here. They use `@zitadel/sdk-next/react` for {@link
 * react!useAuth | useAuth} and `@zitadel/sdk-next/session` for {@link session!getSession |
 * getSession}.
 *
 * @example
 * ```tsx
 * import { auth, ZitadelProvider } from "@zitadel/sdk-next/server";
 * ```
 *
 * @module
 */
export { auth } from "./auth.js";
export type { ZitadelAuthOptions } from "./auth.js";
export { ZitadelProvider } from "./provider.js";
export type {
  ZitadelAuthResult,
  ZitadelAuthState,
  ZitadelUnauthState,
  ZitadelAuthSession,
  ZitadelClientAuthResult,
  ZitadelMiddlewareOptions,
} from "./types.js";
