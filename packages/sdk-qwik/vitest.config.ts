import { qwikVite } from "@qwik.dev/core/optimizer";
import { playwright } from "@vitest/browser-playwright";
import { apiMockPublicDir } from "@zitadel/api-mock/public-dir";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

// Two projects, mirroring the `@zitadel/components` unit/browser split:
//
// - `browser` (real Chromium via Playwright): the client specs. Qwik 2's client
//   `render` locates its root through a `[q:container]` attribute selector that
//   jsdom's selector engine cannot match, and the widgets wrap real Lit custom
//   elements that only upgrade in a real DOM — so a browser is the only
//   environment where `render`, element upgrade, and native custom events all
//   behave as they do in production.
// - `server` (node): `*.server.spec.tsx`. Qwik's `renderToString` is what
//   Qwik Router runs on the server, so it needs Node, not a browser.
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-qwik",
    projects: [
      {
        cacheDir: ".vitest/browser",
        // Serves api-mock's `mockServiceWorker.js` from the test origin, where
        // the MSW worker started in `src/test-setup.ts` registers it.
        publicDir: apiMockPublicDir,
        plugins: [qwikVite()],
        resolve: {
          // Use the browser build so Qwik's client `render()` resolves correctly.
          conditions: ["browser"],
        },
        test: {
          name: "browser",
          globals: true,
          include: ["src/**/*.spec.tsx"],
          exclude: ["src/**/*.server.spec.tsx"],
          setupFiles: ["src/test-setup.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        cacheDir: ".vitest/server",
        plugins: [qwikVite()],
        test: {
          name: "server",
          globals: true,
          environment: "node",
          include: ["src/**/*.server.spec.tsx"],
        },
      },
    ],
  },
});
