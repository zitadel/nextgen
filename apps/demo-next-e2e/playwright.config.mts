import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");

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
  testDir: "./src",
  use: {
    baseURL: "http://localhost:3002",
    trace: "on-first-retry",
  },
  // Boot the mock auth server first so the Next dev server can proxy to
  // it on the very first request. `reuseExistingServer` lets developers
  // run either server manually and have Playwright skip its own boot.
  //
  // `node --run` starts each package's own script without a nested pnpm
  // (which would warn about the platform-specific server packages), and keeps
  // these long-running processes outside Moon's task graph; Playwright owns
  // their lifecycle for this e2e suite.
  webServer: [
    {
      command: "node --run start",
      url: "http://localhost:8080/.well-known/jwks.json",
      reuseExistingServer: true,
      cwd: resolve(workspaceRoot, "packages", "api-mock"),
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "node --run dev",
      url: "http://localhost:3002/login",
      reuseExistingServer: true,
      cwd: resolve(workspaceRoot, "apps", "demo-next"),
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
