/**
 * Filesystem path to the static-asset directory shipped with this package.
 *
 * The canonical `mockServiceWorker.js` (MSW's browser-mode service worker
 * substrate) lives there and is kept in lockstep with the installed `msw`
 * version by MSW's postinstall hook (`"msw": { "workerDirectory": ["public"] }`
 * in this package's `package.json`).
 *
 * Consumers (dev playgrounds, demo apps, e2e harnesses) point their bundler
 * at this directory so the worker is served from `/mockServiceWorker.js` on
 * the consumer's origin — that's where MSW's `setupWorker(...).start()` looks
 * for it by default.
 *
 * Vite example:
 *
 * ```ts
 * import { apiMockPublicDir } from "@zitadel-nextgen/api-mock/public-dir";
 *
 * export default defineConfig({
 *   publicDir: apiMockPublicDir,
 * });
 * ```
 *
 * This module is node-only — it imports `node:url` and `node:path` to resolve
 * its own location at runtime. Do not import it from browser code.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const apiMockPublicDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);
