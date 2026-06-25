/**
 * Vercel serverless entrypoint for the standalone api-mock.
 *
 * This file is **plain JavaScript (`.mjs`) on purpose — do not convert it
 * back to TypeScript.** `@vercel/node` compiles a TypeScript function
 * entry with the project `tsconfig.json`, and that config (via the shared
 * base) skips JavaScript emit, so a `.ts` entry fails the build with
 * `api/index.ts: Emit skipped`. The whole app is already pre-bundled to
 * plain JS by `tsdown` (`dist/app.mjs`), so this entry needs no
 * compilation — keeping it `.mjs` means Vercel has nothing to emit and the
 * failure mode cannot occur. `src/app.ts` stays the typed source of truth
 * (it is what the bundle, the tests, and `local-server.ts` use).
 *
 * Vercel treats every file under `api/` as a serverless function, and the
 * sibling `vercel.json` rewrites every path to it, so the Express app sees
 * the original request URL (`/sessions/exchange`, `/auth/keys`, …) — the
 * one exception is `/.well-known/*`, which Vercel reserves and serves as a
 * static asset instead. Exporting the bare Express `app` as the default
 * export is the documented `@vercel/node` pattern: an Express instance is
 * itself a `(req, res)` request handler.
 */
import { app } from "../dist/app.mjs";

export default app;
