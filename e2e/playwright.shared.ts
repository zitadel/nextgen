/**
 * Settings the in-repo lanes' Playwright configs share (console, demo-next,
 * demo-nuxt; the deployment suite and the journey keep their own).
 *
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
