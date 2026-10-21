import { parentPort, workerData } from "node:worker_threads";

import { qwikVite } from "@qwik.dev/core/optimizer";
import { createServer } from "vite";

// Compiles the wrapper for the server and renders it, as Qwik Router does. This
// runs in a worker because importing Qwik's runtime leaves a MessagePort open
// that would keep Vitest's own process from exiting.
const server = await createServer({
  configFile: false,
  logLevel: "silent",
  plugins: [qwikVite({ csr: true })],
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
});
try {
  await server.pluginContainer.buildStart({});
  const rendered = await server.ssrLoadModule("/src/__tests__/server-login.tsx");
  parentPort?.postMessage(await rendered.renderLogin(workerData));
} finally {
  await server.close();
}
