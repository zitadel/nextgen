import { availableParallelism } from "node:os";

import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";
import { PORT_WORKERS } from "./tests/helpers/ports";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/cli",
    environment: "node",
    // The integration specs drive the built CLI; keep their telemetry off with
    // the cross-tool standard (https://consoledonottrack.com) so a unit run
    // never ships events, independent of the moon/CI env.
    env: { DO_NOT_TRACK: "1" },
    // Both suffixes, for the same reason the shared base matches both: a
    // renamed suite must not vanish silently. Specs are `*.spec.ts`, unit
    // tests `*.test.ts` (tests/AGENTS.md).
    include: ["tests/**/*.{test,spec}.ts"],
    // `offline.ts` first: it fails any test that connects past loopback, so a
    // unit test or spec cannot reach a real server, Zitadel's or anyone's.
    setupFiles: ["./tests/helpers/offline.ts", "./tests/helpers/matchers.ts"],
    // Every file running at the same time takes its ports from a block of its
    // own (tests/helpers/ports.ts), and there are PORT_WORKERS blocks. Vitest's
    // default of a worker per core but one would outnumber them on a bigger
    // machine, so it stops there.
    maxWorkers: Math.min(Math.max(availableParallelism() - 1, 1), PORT_WORKERS),
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
    // hook (`pnpm run build`), so a direct `pnpm test` and a moon run are both
    // self-contained with a fresh build. Same lifecycle-hook pattern as config.
  },
});
