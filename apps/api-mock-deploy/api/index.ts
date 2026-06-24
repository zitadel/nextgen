/**
 * Vercel serverless entrypoint for the standalone api-mock.
 *
 * Vercel treats every file under `api/` as a serverless function. The
 * sibling `vercel.json` rewrites every incoming path to this one
 * function, so the Express app below sees the original request URL
 * (`/sessions/exchange`, `/.well-known/jwks.json`, …) exactly as it
 * would when run locally — Vercel preserves the request URL across the
 * rewrite rather than rewriting it to `/api`.
 *
 * Exporting the bare Express `app` as the default export is the
 * documented `@vercel/node` pattern: an Express instance is itself a
 * `(req, res)` request handler, so Vercel can invoke it directly with
 * no adapter.
 *
 * This imports the **pre-bundled** app from `dist/` (emitted by `tsdown`
 * during the build), not `src/` directly. `@zitadel/api-mock` ships raw
 * TypeScript source, and a Vercel Node function is not guaranteed to
 * transpile a workspace TS dependency at runtime; the bundle inlines all
 * of that into plain JS so this entry has nothing left to resolve but
 * Node built-ins. `src/app.ts` remains the source of truth (and is what
 * `scripts/local-server.ts` and the tests import directly).
 */
import { app } from "../dist/app.mjs";

export default app;
