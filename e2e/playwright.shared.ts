/**
 * Fail-fast timeouts every lane's Playwright config shares, so a wedged or
 * unresponsive server ends a lane with a clear error instead of hanging it. A
 * stale server answering `/healthz` can let readiness pass against the wrong
 * instance; these caps turn that into a quick failure. Spread `e2eTimeouts` at
 * the top level of `defineConfig` and `e2eActionTimeouts` into `use`.
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
