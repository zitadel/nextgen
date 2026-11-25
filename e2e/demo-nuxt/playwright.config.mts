import { defineConfig, devices } from "@playwright/test";
import {
  apiMockServer,
  e2eActionTimeouts,
  e2eTimeouts,
  e2eTrace,
  reuseExistingServer,
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
  // The standalone api-mock drives one sign-in flow at a time, and every page
  // that mounts `<zitadel-login>` starts it over: a spec on a parallel worker
  // would restart or advance the flow of the spec signing in.
  workers: 1,
  use: {
    ...e2eActionTimeouts,
    baseURL: "http://localhost:3001",
    trace: e2eTrace,
  },
  // Boot the mock auth server first so Nitro can proxy to it on the very
  // first request. Playwright owns both long-running processes.
  //
  // The api-mock listens on PORT 8081 here so this project can run in
  // parallel with `e2e/demo-next/` (which uses the default 8080).
  // Both api-mock (`bin/start.ts` reads PORT) and
  // the SDKs (ZITADEL_URL) already accept the override; no
  // application code changes.
  webServer: [
    apiMockServer(8081),
    // The demo's production build, `@zitadel/demo-nuxt#build`'s `.output/`,
    // which the lane depends on. A `nuxt dev` here would be a second Nuxt
    // process in the app beside that build, and the app's tsconfig needs
    // the `.nuxt/` that Nuxt locks to one process. The SDK reads ZITADEL_URL
    // at runtime, never from the build.
    {
      command: "node .output/server/index.mjs",
      url: "http://localhost:3001/login",
      reuseExistingServer,
      cwd: `${workspaceRoot}/apps/demo-nuxt`,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: {
        PORT: "3001",
        ZITADEL_URL: "http://localhost:8081",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
