/**
 * Server-side surface of `@zitadel/sdk-next`: everything here is guarded by
 * `server-only` and fails the build if pulled into a `"use client"` graph.
 *
 * ```tsx
 * import { auth, NextgenProvider } from "@zitadel/sdk-next/server";
 * ```
 */
export { auth } from "./auth.js";
export type { AuthOptions } from "./auth.js";
export { NextgenProvider } from "./provider.js";
