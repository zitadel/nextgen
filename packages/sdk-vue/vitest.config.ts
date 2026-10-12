import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-vue",
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
});
