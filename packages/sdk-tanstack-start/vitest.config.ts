import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

/**
 * Two projects in one config:
 *
 * - `server` (node): the request middleware and the rest of the server code.
 * - `react` (jsdom): the `/react` widgets, server-rendered and then hydrated.
 *   `resolve.conditions: ['browser']` resolves the browser build of
 *   `@lit/react`, which binds props and listeners on the client the way a real
 *   app's bundle does; its default Node build only renders.
 */
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-tanstack-start",
    projects: [
      {
        // Each project is its own Vite instance, so each gets its own cacheDir.
        cacheDir: ".vitest/server",
        test: {
          name: "server",
          globals: true,
          environment: "node",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/react.test.tsx"],
        },
      },
      {
        cacheDir: ".vitest/react",
        resolve: { conditions: ["browser"] },
        test: {
          name: "react",
          globals: true,
          environment: "jsdom",
          include: ["src/**/react.test.tsx"],
        },
      },
    ],
  },
});
