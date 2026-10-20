import { defineConfig } from "vitest/config";

import { baseTest } from "./vitest.shared.mjs";

/**
 * Root workspace-tooling tests (all Vitest, run in Node). This is not a project
 * aggregator — it never descends into `apps/*` or `packages/*` (each of those
 * has its own config and moon `test` task); `include` names only the root
 * `scripts/` tests. The `workspace:test` task runs the general ones; the
 * `check-typecheck` / `check-openapi-rules` tasks filter this same config down
 * to their one file (then run their audit script), so they share one config.
 */
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/workspace",
    environment: "node",
    include: ["scripts/**/*.test.mjs", "scripts/**/*.test.ts"],
    // Root tests exercise scripts/, not src/ (there is none at the repo root).
    coverage: { ...baseTest.coverage, include: ["scripts/**/*.{mjs,ts}"] },
    // Several of these run slow work (the redocly lint, tsc program audits)
    // that run well past Vitest's 5s default; node:test had no timeout.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
