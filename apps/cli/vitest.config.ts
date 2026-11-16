import { availableParallelism } from "node:os";

import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";
import { aliases } from "./tests/helpers/aliases";
import { PORT_WORKERS } from "./tests/helpers/ports";

/** Three quarters of the cores, at least one: 3 workers on CI's 4-core runners. */
const WORKERS = Math.max(Math.floor((availableParallelism() * 3) / 4), 1);

/**
 * How long a test or hook may take. CI gets three times the room: there the
 * suite runs in one turbo graph beside the journeys and the e2e lanes, and
 * when only the CLI changed they all start with it. A test's first load of
 * the built CLI then took 24 s where a run that builds everything first took
 * 13 s. A retry does not recover such a test: the attempt that timed out is
 * still writing into the fixture directory the next one clears.
 */
const TIMEOUT = process.env.CI ? 60_000 : 20_000;

export default defineConfig({
  cacheDir: ".vitest",
  resolve: { alias: aliases },
  test: {
    ...baseTest,
    name: "@zitadel/cli",
    environment: "node",
    // Undo `vi.spyOn`, `vi.stubEnv` and `vi.stubGlobal` before every test, so no
    // file restores them by hand.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // The integration specs drive the built CLI; keep their telemetry off with
    // the cross-tool standard (https://consoledonottrack.com) so a unit run
    // never ships events, independent of the task runner's or CI's env.
    // CI markers are blanked for the code under test (the retry below reads the
    // real one at config time), so a suite behaves the same on a CI runner as
    // on a laptop: `preview` and the skills hint branch on running in CI, and
    // a deploy's default message on the build's own.
    env: {
      GITHUB_EVENT_NAME: "",
      VERCEL_GIT_COMMIT_MESSAGE: "",
      DO_NOT_TRACK: "1",
      // A run asks the npm registry only where a test arranges the answer.
      ZITADEL_UPDATE_CHECK: "0",
      CI: "",
      GITHUB_ACTIONS: "",
      GITLAB_CI: "",
      CIRCLECI: "",
      BUILDKITE: "",
      JENKINS_URL: "",
      CF_PAGES: "",
      TF_BUILD: "",
      CODEBUILD_BUILD_ID: "",
    },
    // Both suffixes, for the same reason the shared base matches both: a
    // renamed suite must not vanish silently. Specs are `*.spec.ts`, unit
    // tests `*.test.ts` (tests/AGENTS.md).
    include: ["tests/**/*.{test,spec}.ts"],
    // Before anything runs, ends the fake servers an interrupted earlier run
    // left on ports from the test band (tests/helpers/stale-servers.ts).
    globalSetup: ["./tests/helpers/stale-servers.ts"],
    // `offline.ts` first: it fails any test that connects past loopback, so a
    // unit test or spec cannot reach a real server, Zitadel's or anyone's.
    setupFiles: [
      "./tests/helpers/offline.ts",
      "./tests/helpers/matchers.ts",
      "./tests/helpers/timers.ts",
      "./tests/helpers/console.ts",
    ],
    // Every file running at the same time takes its ports from a block of its
    // own (tests/helpers/ports.ts), and there are PORT_WORKERS blocks, so the
    // pool stops there on a bigger machine. It also leaves a quarter of the
    // cores free instead of Vitest's one: each worker holds about 600 MB (a
    // fresh process per file that builds the generated API schemas again), and
    // this suite runs beside the rest of CI's task graph. A fixed headroom
    // would leave a single worker on a 4-core runner.
    maxWorkers: Math.min(WORKERS, PORT_WORKERS),
    // The integration specs drive the built CLI against a `usePlatformMock()`
    // HTTP server. Under CI's parallel worker pool that mock occasionally
    // isn't ready when a spec's `aSetUpApp()` arrange runs, and the
    // "against an invalid server" specs deliberately talk to a down/invalid
    // host and wait out a real network timeout — both comfortably exceed
    // Vitest's 5s default under load. Give them room (TIMEOUT), and retry in
    // CI only (locally we want a flake to surface, not be papered over). A
    // genuine regression still fails deterministically after the retries.
    testTimeout: TIMEOUT,
    hookTimeout: TIMEOUT,
    retry: process.env.CI ? 2 : 0,
    coverage: {
      ...baseTest.coverage,
      // The specs drive the built CLI, so their execution is attributed to
      // `dist`. Without it they register as ~0% and the suite looks untested
      // at the only level that proves the pieces are wired together; the build
      // emits sourcemaps, so v8 reports these back against `src`.
      include: [...(baseTest.coverage?.include ?? []), "dist/**/*.mjs"],
    },
    // The oclif dist the integration suite drives comes from the package's
    // `build`, which turbo's `test` depends on (turbo.json).
  },
});
