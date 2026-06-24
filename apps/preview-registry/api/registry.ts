import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import { createFsStore } from "../src/storage.js";

/**
 * Resolve the directory the snapshot bundle lives in, regardless of
 * whether the function was shipped as ESM or transpiled to CJS by the
 * Vercel builder. Tries `__dirname` first (CJS), then
 * `import.meta.url` (native ESM), and finally `process.cwd()` so the
 * registry still serves the right files if either of those become
 * undefined in a future runtime.
 */
const resolveFunctionDirectory = (): string => {
  const cjsDirectory = typeof __dirname === "string" ? __dirname : undefined;
  if (cjsDirectory) return cjsDirectory;
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

/**
 * Absolute path to the snapshot bundle the Vercel build shipped with
 * this function. The build's `includeFiles` rule places `.snapshots/`
 * next to the function file, so it resolves one directory above.
 */
const SNAPSHOT_ROOT = resolve(resolveFunctionDirectory(), "..", ".snapshots");

/**
 * URL prefix the registry advertises in tarball download URLs at
 * runtime. Vercel sets `VERCEL_URL` to the per-deploy hostname.
 */
const PUBLIC_BASE = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";

/** Hono app instance — constructed once at module load, reused per request. */
const app = createApp(createFsStore(SNAPSHOT_ROOT, PUBLIC_BASE));

/**
 * Vercel's `@vercel/node` runtime treats a default export as the
 * classic `(req, res) => void` Node HTTP signature, but Hono is a
 * web-Fetch app. Exporting `fetch` makes Vercel route requests
 * through the Fetch signature instead. Only one named export is
 * needed; exporting both `fetch` and individual HTTP method names
 * causes the runtime to dispatch the request twice.
 */
export const fetch = app.fetch;
