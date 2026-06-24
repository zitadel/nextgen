import type { Express } from "express";

import { createMockApp } from "@zitadel/api-mock/server";

import { resolveIssuer } from "./issuer.js";

/**
 * The configured Express app for this deployment.
 *
 * All routing and behaviour lives in `@zitadel/api-mock`; this module
 * only pins the issuer for the current environment. The Vercel
 * entrypoint (`api/index.ts`) re-exports this as its default export.
 */
export const app: Express = createMockApp({ issuer: resolveIssuer() });
