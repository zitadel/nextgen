import type { Express } from "express";

import { createMockApp } from "@zitadel/api-mock/server";

import { resolveIssuer } from "./issuer.js";

/**
 * Build the deployment's Express app, optionally overriding the issuer.
 *
 * All routing and behaviour lives in `@zitadel/api-mock`; this factory
 * only pins the issuer. It defaults to {@link resolveIssuer} (which reads
 * the environment) so the Vercel entrypoint can call `createApp()` with
 * no arguments, while tests and other runtimes can inject a deterministic
 * issuer instead of mutating `process.env`.
 *
 * @param options.issuer - Issuer to advertise. Defaults to the
 *   environment-derived value from {@link resolveIssuer}.
 */
export function createApp(options: { issuer?: string } = {}): Express {
  return createMockApp({ issuer: options.issuer ?? resolveIssuer() });
}

/**
 * The configured Express app for this deployment, built from the ambient
 * environment. The Vercel entrypoint (`api/index.mjs`) re-exports this as
 * its default export.
 */
export const app: Express = createApp();
