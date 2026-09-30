import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/cli",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The oclif dist the integration suite drives is built by the `pretest`
    // hook (`pnpm run build`), so a direct `pnpm test` and a moon run are both
    // self-contained with a fresh build. Same lifecycle-hook pattern as config.
  },
});
