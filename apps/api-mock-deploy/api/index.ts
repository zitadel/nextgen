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
 * no adapter. The app itself is built in `src/app.ts`.
 */
import { app } from "../src/app.js";

export default app;
