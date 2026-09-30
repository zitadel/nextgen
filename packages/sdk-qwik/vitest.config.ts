import { qwikVite } from "@builder.io/qwik/optimizer";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  plugins: [qwikVite()],
  resolve: {
    // Use the browser build so Qwik's client `render()` works under jsdom.
    conditions: ["browser"],
  },
  test: {
    ...baseTest,
    name: "@zitadel/sdk-qwik",
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
});
