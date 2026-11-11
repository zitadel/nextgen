import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/cloud-console",
    environment: "node",
  },
});
