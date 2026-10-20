import { defineConfig } from "vitest/config";

import { baseTest, edgeProject } from "../../vitest.shared.mjs";

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
      // The `/server` entry is what runs on the edge, with the JWT helpers it
      // verifies sessions with: both must run in the edge VM.
      edgeProject({
        include: ["src/__tests__/middleware.test.ts", "src/__tests__/lib/jwt.test.ts"],
      }),
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
