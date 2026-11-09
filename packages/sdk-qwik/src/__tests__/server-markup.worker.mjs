import { parentPort } from "node:worker_threads";

import { qwikVite } from "@qwik.dev/core/optimizer";
import { createServer } from "vite";

// Compiles the wrapper for the server once, as Qwik Router does, and renders it
// for each request. This runs in a worker because importing Qwik's runtime
// leaves a MessagePort open that would keep Vitest's own process from exiting;
// the parent terminates the worker instead.
const server = await createServer({
  configFile: false,
  logLevel: "silent",
  plugins: [qwikVite({ csr: true })],
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
});
let rendered;
try {
  await server.pluginContainer.buildStart({});
  rendered = await server.ssrLoadModule("/src/__tests__/server-login.tsx");
} finally {
  await server.close();
}
parentPort?.on("message", async ({ props, reply }) => {
  try {
    reply.postMessage({ html: await rendered.renderLogin(props) });
  } catch (error) {
    reply.postMessage({ error });
  }
});
parentPort?.postMessage("loaded");
