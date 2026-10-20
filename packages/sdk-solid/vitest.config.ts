import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

/**
 * Three projects in one config, one per way Solid compiles the wrappers:
 *
 * - `dom` (jsdom): compiled for the browser, as a client-only Solid app runs
 *   them.
 * - `ssr` (node): `*.ssr.spec.tsx` is compiled for the server with
 *   `vite-plugin-solid({ ssr: true })`, as a server-rendering app runs them.
 * - `hydrate` (jsdom): `*.hydrate.spec.tsx` is compiled for hydration
 *   (`hydratable`) and takes its server markup from the server compile of the
 *   same wrappers.
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
          exclude: ["src/**/*.ssr.spec.tsx", "src/**/*.hydrate.spec.tsx"],
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
      {
        cacheDir: ".vitest/hydrate",
        plugins: [solid({ solid: { hydratable: true } })],
        test: {
          name: "hydrate",
          globals: true,
          environment: "jsdom",
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.hydrate.spec.tsx"],
        },
      },
    ],
  },
});
