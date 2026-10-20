import { svelte } from "@sveltejs/vite-plugin-svelte";
import { configDefaults, defineConfig } from "vitest/config";

import { baseTest, edgeProject, edgeSpecs } from "../../vitest.shared.mjs";

/**
 * Two projects in one config:
 *
 * - `dom` (jsdom): the components compiled for the browser, mounted and
 *   hydrated with Svelte's browser build.
 * - `ssr` (node): `*.ssr.spec.ts` renders the components with `svelte/server`,
 *   which the plugin compiles for the server, without the `browser` condition.
 */
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-svelte",
    projects: [
      {
        // Each project is its own Vite instance, so each gets its own cacheDir.
        cacheDir: ".vitest/dom",
        plugins: [svelte()],
        resolve: {
          // Use Svelte's browser build so client-side `mount()` works under jsdom.
          conditions: ["browser"],
        },
        test: {
          name: "dom",
          globals: true,
          environment: "jsdom",
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.ts"],
          // Never run the svelte-package build output (a staged copy of the spec).
          exclude: [...configDefaults.exclude, ".svelte-kit/**", "src/**/*.ssr.spec.ts", edgeSpecs],
        },
      },
      {
        cacheDir: ".vitest/ssr",
        plugins: [svelte()],
        test: {
          name: "ssr",
          globals: true,
          environment: "node",
          include: ["src/**/*.ssr.spec.ts"],
          exclude: [...configDefaults.exclude, ".svelte-kit/**"],
        },
      },
      // Runs the edge specs in the edge-runtime VM; see edgeProject in vitest.shared.mjs.
      edgeProject({
        conditions: ["worker"],
        // Svelte loads `node:async_hooks` for its async server rendering, which
        // Workers (`nodejs_compat`) and Vercel Edge both provide.
        polyfilledPackages: ["svelte"],
        plugins: [svelte()],
      }),
    ],
  },
});
