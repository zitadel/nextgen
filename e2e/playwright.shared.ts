import { join } from "node:path";

import { devices, type PlaywrightTestConfig } from "@playwright/test";

/**
 * Settings the in-repo lanes' Playwright configs share (console, demo-next,
 * demo-nuxt). Three keep their own on purpose: the deployment suite (no
 * traces, no HTML report, so the bypass secret stays out of uploads), the
 * journey (its lanes would have to list this file as an input and run on every
 * edit to it), and the testkit fixture, which is copied into the scaffolded app
 * and stays shaped like a customer's config.
 *
 * Nothing here imports the test kit: the smoke and mock lanes build none.
 */

/** The repository root: the cwd of the webServer commands. */
export const workspaceRoot = join(import.meta.dirname, "..");

/**
 * Fail-fast timeouts, so a wedged or unresponsive server ends a lane with a
 * clear error instead of hanging it. A stale server answering `/healthz` can
 * let readiness pass against the wrong instance; these caps turn that into a
 * quick failure. Spread `e2eTimeouts` at the top level of `defineConfig` and
 * `e2eActionTimeouts` into `use`.
 */
export const e2eTimeouts = {
  /** Per-test cap. */
  timeout: 60_000,
  /** Whole-lane cap: the backstop against a run that never ends. */
  globalTimeout: 600_000,
};

export const e2eActionTimeouts = {
  /** A click or fill that hangs fails here, not after the test timeout. */
  actionTimeout: 15_000,
  /** A navigation or redirect that hangs (a wedged server) fails here. */
  navigationTimeout: 30_000,
};

/**
 * `use.trace` for every lane: record each test, keep the trace of the ones
 * that fail. Moon runs the lanes without `CI`, so they never retry, and
 * `on-first-retry` would never record a trace for the diagnostics upload.
 */
export const e2eTrace = "retain-on-failure" as const;

/** Every lane runs its specs in desktop Chromium, and in nothing else. */
export const chromiumProjects: PlaywrightTestConfig["projects"] = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
];

/**
 * `withZitadel`'s `zitadel` options for the lanes that boot a real instance:
 * the source-built server binary, which `moon run server:build` writes (the
 * moon tasks set ZITADEL_SERVER_BINARY to the same path). That build embeds
 * the console's dist, so a lane tests the working tree's console.
 */
export const inRepoZitadel = {
  serverBinary:
    process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
  serverBinaryHint: "run `moon run server:build` first.",
};

/**
 * The real-instance lanes' defaults: one instance shared by two workers, each
 * test seeding its own user, and the lane's results and report under its own
 * name (`lane`), so lanes sharing a folder do not overwrite each other's.
 */
export function realLaneDefaults(
  lane: string,
): Pick<PlaywrightTestConfig, "fullyParallel" | "workers" | "outputDir" | "reporter"> {
  return {
    fullyParallel: true,
    workers: 2,
    outputDir: `test-results/${lane}`,
    reporter: [["list"], ["html", { open: "never", outputFolder: `playwright-report/${lane}` }]],
  };
}

type WebServer = Exclude<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]>;

/**
 * The standalone `@zitadel/api-mock` server on `port`, for the mock lanes'
 * `webServer`, booted first so the demo can proxy to it on its very first
 * request. `reuseExistingServer` lets a developer run it by hand instead.
 */
export function apiMockServer(port: number): WebServer {
  return {
    command: "pnpm --filter @zitadel/api-mock start",
    url: `http://localhost:${port}/.well-known/jwks.json`,
    reuseExistingServer: true,
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { PORT: String(port) },
  };
}
