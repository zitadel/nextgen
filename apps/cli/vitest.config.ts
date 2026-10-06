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
    setupFiles: ["./tests/helpers/matchers.ts"],
    // The integration specs drive the built CLI against a `usePlatformMock()`
    // HTTP server. Under CI's parallel worker pool that mock occasionally
    // isn't ready when a spec's `aSetUpApp()` arrange runs, and the
    // "against an invalid server" specs deliberately talk to a down/invalid
    // host and wait out a real network timeout — both comfortably exceed
    // Vitest's 5s default under load. Give them room, and retry in CI only
    // (locally we want a flake to surface, not be papered over). A genuine
    // regression still fails deterministically after the retries.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    retry: process.env.CI ? 2 : 0,
    coverage: {
      ...baseTest.coverage,
      // The specs drive the built CLI, so their execution is attributed to
      // `dist`. Without it they register as ~0% and the suite looks untested
      // at the only level that proves the pieces are wired together; the build
      // emits sourcemaps, so v8 reports these back against `src`.
      include: [...(baseTest.coverage?.include ?? []), "dist/**/*.mjs"],
    },
    // The oclif dist the integration suite drives is built by the `pretest`
    // hook for a direct `pnpm test`, and by the `build` task moon's `test`
    // depends on for a moon run, so both start from a fresh build.
  },
});
