/**
 * Server-renders one export of `src/__tests__/ssr-fixture.tsx` and posts the
 * HTML back to the parent. Runs in a worker thread (see the `renderSsr` browser
 * command in vitest.config.ts) because importing Qwik's core on Node opens a
 * `MessageChannel` that is never closed, which would keep Vitest's process
 * alive; terminating the worker releases it.
 */
import { parentPort, workerData } from "node:worker_threads";

import { qwikVite } from "@qwik.dev/core/optimizer";
import { createServer } from "vite";

const fixture = "/src/__tests__/ssr-fixture.tsx";

// A plain Vite SSR server (not Vitest's), so node_modules are externalised and
// resolved with Node conditions, as in a Qwik City app. The QRL chunk paths it
// serialises (`/src/index.tsx_…js`) are the dev URLs Vitest's browser server
// serves, so the browser resumes against the same module graph.
const server = await createServer({
  configFile: false,
  root: new URL("..", import.meta.url).pathname,
  plugins: [qwikVite({ client: { input: `.${fixture}` } })],
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  logLevel: "error",
});
try {
  const mod = await server.ssrLoadModule(fixture);
  parentPort?.postMessage(await mod[workerData.name]());
} finally {
  await server.close();
}
