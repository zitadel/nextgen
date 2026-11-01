import { qwikVite } from "@qwik.dev/core/optimizer";
import { playwright } from "@vitest/browser-playwright";
import { apiMockPublicDir } from "@zitadel/api-mock/public-dir";
import { defineConfig } from "vitest/config";

import { baseTest, edgeProject, edgeSpecs } from "@zitadel/vitest-config";
import {
  closeServerLogin,
  loadServerLogin,
  renderServerLogin,
} from "./src/__tests__/server-markup.ts";

/**
 * Two projects in one config:
 *
 * - `browser` (Chromium via Playwright): the wrappers as a Qwik app runs them
 *   on the client. Qwik 2's client `render` locates its root through a
 *   `[q:container]` attribute selector that jsdom's selector engine cannot
 *   match, and the widgets wrap real Lit custom elements that only upgrade in a
 *   real DOM, so a browser is the only environment where `render`, element
 *   upgrade, and native custom events behave as they do in production.
 * - `ssr` (node): `*.ssr.spec.tsx` imports the component source (`./index`) and
 *   renders it with `renderToString`, as Qwik Router does on the server. It
 *   checks the markup the components write.
 */
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-qwik",
    projects: [
      {
        // Each project is its own Vite instance, so each gets its own cacheDir.
        cacheDir: ".vitest/browser",
        // Serves api-mock's `mockServiceWorker.js` from the test origin, where the
        // MSW worker started in `src/test-setup.ts` registers it.
        publicDir: apiMockPublicDir,
        plugins: [qwikVite()],
        resolve: {
          // Use the browser build so Qwik's client `render()` resolves correctly.
          conditions: ["browser"],
        },
        test: {
          name: "browser",
          globals: true,
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/*.ssr.spec.tsx", edgeSpecs],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
            // Node-side helpers a browser spec calls through `commands`.
            commands: { loadServerLogin, renderServerLogin, closeServerLogin },
          },
        },
      },
      {
        cacheDir: ".vitest/ssr",
        plugins: [qwikVite()],
        test: {
          name: "ssr",
          globals: true,
          environment: "node",
          include: ["src/**/*.ssr.spec.tsx"],
        },
      },
      // Runs the edge specs in the edge-runtime VM; see edgeProject in vitest.shared.mjs.
      edgeProject({
        // Qwik keeps its request context in an AsyncLocalStorage, which Workers
        // (`nodejs_compat`) and Vercel Edge both provide.
        polyfilledPackages: ["@qwik.dev/core"],
        plugins: [qwikVite()],
      }),
    ],
  },
});
