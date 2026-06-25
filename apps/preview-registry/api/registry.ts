import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import { createFsStore } from "../src/storage.js";

/**
 * Resolve the absolute path to the snapshot bundle the Vercel build
 * shipped with this function, regardless of whether it was shipped as
 * ESM or transpiled to CJS.
 *
 * `__dirname` (CJS) and `import.meta.url` (native ESM) both point at the
 * compiled function file's directory (`<bundle>/api`), so `.snapshots`
 * — which the build's `includeFiles` rule places at the bundle root —
 * is one level up. The `process.cwd()` fallback is different: the
 * function's working directory is already the bundle root, so the
 * snapshot directory sits directly under it, not one level up.
 */
const resolveSnapshotRoot = (): string => {
  const cjsDirectory = typeof __dirname === "string" ? __dirname : undefined;
  if (cjsDirectory) return resolve(cjsDirectory, "..", ".snapshots");
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..", ".snapshots");
  } catch {
    return resolve(process.cwd(), ".snapshots");
  }
};

/** Absolute path to the bundled snapshot tarballs. */
const SNAPSHOT_ROOT = resolveSnapshotRoot();

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
