import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/config",
    environment: "node",
    // Copy the server's meta-schemas into `meta-schemas/` before the suite, so
    // `vitest run` needs no `sync-meta-schemas` step chained ahead of it.
    globalSetup: ["./vitest.global-setup.mjs"],
  },
});
