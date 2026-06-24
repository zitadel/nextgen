import { serve } from "@hono/node-server";
import { resolve } from "node:path";

import { createApp } from "../src/app.js";
import { createFsStore } from "../src/storage.js";

/**
 * Start a local Node HTTP server that exposes the same Hono app the
 * Vercel function serves. The storage root mirrors the
 * `apps/preview-registry/.snapshots/` directory the production build
 * writes to, so the local dev round-trip is byte-identical to a
 * deployed Vercel preview.
 */
const startLocalServer = async (): Promise<void> => {
  const port = Number(process.env.PORT ?? 3000);
  const storageRoot = resolve(import.meta.dirname, "..", ".snapshots");
  const publicBase = `http://localhost:${port}`;

  const app = createApp(createFsStore(storageRoot, publicBase));

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`preview-registry on http://localhost:${info.port}`);
    console.log(`storage backend: fs @ ${storageRoot}`);
  });
};

await startLocalServer();
