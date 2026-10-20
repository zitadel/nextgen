import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { baseTest, edgeProject } from "../../vitest.shared.mjs";

// Stub Nuxt's `#imports` virtual module so vitest can resolve sources that
// pull from it (e.g. `useRuntimeConfig`) without bootstrapping Nuxt's module
// resolver.
const alias = {
  "#imports": fileURLToPath(new URL("./src/__tests__/stubs/nuxt-imports.ts", import.meta.url)),
};

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-nuxt",
    projects: [
      {
        cacheDir: ".vitest/node",
        resolve: { alias },
        test: {
          name: "node",
          globals: true,
          environment: "node",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/*.edge.spec.ts"],
        },
      },
      // The server middleware runs on edge Nitro presets, so it must run in the
      // edge VM too, which has no `node:` modules and no socket.
      // h3 depends on `node-mock-http` for its Node adapter, which Nitro's edge
      // presets polyfill with unenv; nothing of ours reaches a Node built-in.
      edgeProject({
        include: ["src/**/*.edge.spec.ts"],
        alias,
        polyfilledPackages: ["node-mock-http"],
      }),
    ],
  },
});
