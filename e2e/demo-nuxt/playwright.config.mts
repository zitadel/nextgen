import { defineConfig, devices } from "@playwright/test";
import {
  apiMockServer,
  e2eActionTimeouts,
  e2eTimeouts,
  e2eTrace,
  workspaceRoot,
} from "../playwright.shared";

/**
 * E2E coverage for the embedded sign-in path on Nuxt:
 *
 *   demo-nuxt /login → <zitadel-login> → /__nextgen proxy
 *                    → api-mock TCP server → the project's session cookie
 *                    → /admin (server-rendered, authenticated)
 *
 * The Vue / Nitro story is structurally similar to the demo-next lanes but the
 * proxy and route-protection layers come from `@zitadel/sdk-nuxt`'s Nitro
 * middleware rather than `@zitadel/sdk-next`'s edge middleware.
 * Running the same scenario on both demos is the only way to catch a
 * regression in one SDK without the other.
 *
 * Component / orchestrator behaviour is covered by `packages/components`'s
 * Vitest suite — do not duplicate it here. See `e2e/demo-next/AGENTS.md`,
 * the guide to both demo lanes.
 */
export default defineConfig({
  ...e2eTimeouts,
  testDir: "./src",
  outputDir: "test-results/mock",
  use: {
    ...e2eActionTimeouts,
    baseURL: "http://localhost:3001",
    trace: e2eTrace,
  },
  // Boot the mock auth server first so Nitro can proxy to it on the very
  // first request. Direct pnpm filter commands keep these long-running
  // processes outside Moon's task graph; Playwright owns their lifecycle.
  //
  // The api-mock listens on PORT 8081 here so this project can run in
  // parallel with `e2e/demo-next/` (which uses the default 8080).
  // Both api-mock (`bin/start.ts` reads PORT) and
  // the SDKs (ZITADEL_URL) already accept the override; no
  // application code changes.
  webServer: [
    apiMockServer(8081),
    {
      command: "pnpm --filter @zitadel/demo-nuxt dev",
      url: "http://localhost:3001/login",
      reuseExistingServer: true,
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: {
        ZITADEL_URL: "http://localhost:8081",
      },
    },
  ],
  projects: [
    // One load of /login before the specs, so none of them waits while
    // `nuxt dev` builds the browser's modules (src/warm-up.setup.ts).
    { name: "warm-up", testMatch: /warm-up\.setup\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["warm-up"] },
  ],
});
