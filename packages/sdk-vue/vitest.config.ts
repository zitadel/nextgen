import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/sdk-vue",
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
});
