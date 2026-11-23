import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/config",
    environment: "node",
    // meta-schemas are synced before Vitest runs, not by a global setup: by
    // the `sync-schemas` task the turbo build depends on (turbo.json).
  },
});
