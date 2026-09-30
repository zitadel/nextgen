import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  plugins: [solid()],
  test: {
    ...baseTest,
    name: "@zitadel/sdk-solid",
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
});
