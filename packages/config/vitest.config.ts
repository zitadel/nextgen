import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/config",
    environment: "node",
    // meta-schemas are synced before Vitest runs, not by a global setup: the
    // moon `sync-schemas` dep (mutex: generated-sources) syncs them; a direct
    // `pnpm test` needs a prior `pnpm run sync-schemas`.
  },
});
