import { defineConfig } from "vitest/config";

import { baseTest, edgeProject, edgeSpecs } from "../../vitest.shared.mjs";

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
          exclude: [edgeSpecs],
        },
      },
      // Runs the edge specs in the edge-runtime VM; see edgeProject in vitest.shared.mjs.
      edgeProject({}),
    ],
  },
});
