import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/cli",
    environment: "node",
    // Both suffixes, for the same reason the shared base matches both: a
    // renamed suite must not vanish silently. Specs are `*.spec.ts`, unit
    // tests `*.test.ts` (tests/AGENTS.md).
    include: ["tests/**/*.{test,spec}.ts"],
    coverage: {
      ...baseTest.coverage,
      // The specs drive the built CLI, so their execution is attributed to
      // `dist`. Without it they register as ~0% and the suite looks untested
      // at the only level that proves the pieces are wired together; the build
      // emits sourcemaps, so v8 reports these back against `src`.
      include: [...(baseTest.coverage?.include ?? []), "dist/**/*.mjs"],
    },
    // The oclif dist the integration suite drives is built by the `pretest`
    // hook (`pnpm run build`), so a direct `pnpm test` and a moon run are both
    // self-contained with a fresh build. Same lifecycle-hook pattern as config.
  },
});
