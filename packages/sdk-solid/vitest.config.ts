import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

/**
 * Two projects in one config:
 *
 * - `dom` (jsdom): the wrappers compiled for the browser, as a client-only
 *   Solid app runs them.
 * - `ssr` (node): `*.ssr.spec.tsx` imports the component source (`./index`)
 *   and `vite-plugin-solid({ ssr: true })` compiles it for the server. It
 *   checks the markup the components write, not the published package
 *   entry, which this config leaves unchanged.
 */
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-solid",
    projects: [
      {
        // Each project is its own Vite instance, so each gets its own cacheDir.
        cacheDir: ".vitest/dom",
        plugins: [solid()],
        test: {
          name: "dom",
          globals: true,
          environment: "jsdom",
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/*.ssr.spec.tsx"],
        },
      },
      {
        cacheDir: ".vitest/ssr",
        plugins: [solid({ ssr: true })],
        test: {
          name: "ssr",
          globals: true,
          environment: "node",
          include: ["src/**/*.ssr.spec.tsx"],
        },
      },
    ],
  },
});
