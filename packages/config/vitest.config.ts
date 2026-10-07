import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/config",
    environment: "node",
    // meta-schemas are synced before Vitest runs, not by a global setup: the
    // `pretest` hook (`node scripts/sync-meta-schemas.mjs`) covers a direct
    // `pnpm test`, `test:all` runs the same sync itself, and the moon
    // `sync-schemas` dep (mutex: generated-sources) covers the moon graph.
  },
});
