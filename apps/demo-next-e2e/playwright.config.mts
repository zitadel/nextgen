import { workspaceRoot } from "@nx/devkit";
import { nxE2EPreset } from "@nx/playwright/preset";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E coverage for the embedded sign-in path:
 *
 *   demo-next /login → <zitadel-login> → /__nextgen proxy
 *                    → api-mock TCP server → __nextgen_session cookie
 *                    → /admin (server-rendered, authenticated)
 *
 * This is the integration gap that Vitest cannot reach: real Next
 * middleware, the SDK proxy, the mock server's RS256 handoff
 * verification, and full-page navigation triggered by the component's
 * internal `POST /sessions/exchange`. Component / orchestrator behaviour
 * (form participation, step transitions, exchange call shape) is covered
 * by `packages/components`'s Vitest suite — do not duplicate it here.
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.filename, { testDir: "./src" }),
  use: {
    baseURL: "http://localhost:3002",
    trace: "on-first-retry",
  },
  // Boot the mock auth server first so the Next dev server can proxy to
  // it on the very first request. `reuseExistingServer` lets developers
  // run either server manually and have Playwright skip its own boot.
  //
  // Direct pnpm filter commands (rather than `nx run …`) avoid the
  // `@nx/playwright/plugin` task graph treating these long-running
  // processes as e2e dependencies that must complete first.
  webServer: [
    {
      command: "pnpm --filter @zitadel-nextgen/api-mock start",
      url: "http://localhost:8080/.well-known/jwks.json",
      reuseExistingServer: true,
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @zitadel-nextgen/demo-next dev",
      url: "http://localhost:3002/login",
      reuseExistingServer: true,
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      env: {
        ZITADEL_URL: "http://localhost:8080",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
