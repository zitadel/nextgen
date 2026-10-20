import { defineConfig } from "vitest/config";

import { baseTest, edgeProject } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-vue",
    projects: [
      {
        cacheDir: ".vitest/jsdom",
        test: {
          name: "jsdom",
          globals: true,
          environment: "jsdom",
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/*.edge.spec.ts"],
        },
      },
      // The SDK imports `@zitadel/components` for registration and locale
      // data only, so on the edge it resolves to the components' Lit-free
      // entry; `workerd` selects it, as Wrangler does.
      edgeProject({ include: ["src/**/*.edge.spec.ts"], conditions: ["workerd"] }),
    ],
  },
});
