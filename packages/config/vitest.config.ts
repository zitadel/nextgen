import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/config",
    environment: "node",
    // meta-schemas are synced before Vitest runs, not by a global setup: the
    // `pretest` lifecycle hook (`pnpm run sync-schemas`) covers a direct
    // `pnpm test` / `pnpm test:all`, and the moon `sync-schemas` dep
    // (mutex: generated-sources) covers the moon graph.
  },
});
