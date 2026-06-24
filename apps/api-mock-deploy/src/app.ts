import type { Express } from "express";

import { createMockApp } from "@zitadel/api-mock/server";

/**
 * Resolve the absolute base URL this deployment advertises as its OIDC
 * issuer.
 *
 * On Vercel, `VERCEL_URL` holds the immutable per-deployment domain
 * (e.g. `nextgen-api-mock-git-pr-123.vercel.app`) — every preview build
 * gets its own, which is exactly the per-PR isolation we want. Falling
 * back to a localhost issuer keeps `vercel dev` and plain `node` runs
 * working unchanged.
 *
 * The value only has to be internally consistent: the mock both signs
 * handoff tokens with this issuer and verifies them against it, so as
 * long as a single deployment uses one issuer string, exchange succeeds
 * regardless of which alias the caller hit.
 *
 * @param env - Environment to read from; injectable for tests.
 */
export function resolveIssuer(env: NodeJS.ProcessEnv = process.env): string {
  return env.VERCEL_URL ? `https://${env.VERCEL_URL}` : `http://localhost:${env.PORT ?? "8080"}`;
}

/**
 * The configured Express app for this deployment.
 *
 * All routing and behaviour lives in `@zitadel/api-mock`; this module
 * only pins the issuer for the current environment. The Vercel
 * entrypoint (`api/index.ts`) re-exports this as its default export.
 */
export const app: Express = createMockApp({ issuer: resolveIssuer() });
