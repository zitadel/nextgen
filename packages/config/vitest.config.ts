import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/config",
    environment: "node",
    // meta-schemas are copied by the shared root global setup (inherited from
    // baseTest); the moon `sync-schemas` dep still covers the build/typecheck graph.
  },
});
