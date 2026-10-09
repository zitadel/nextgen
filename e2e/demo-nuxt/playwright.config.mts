import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");

/**
 * E2E coverage for the embedded sign-in path on Nuxt:
 *
 *   demo-nuxt /login → <zitadel-login> → /__nextgen proxy
 *                    → api-mock TCP server → __nextgen_session cookie
 *                    → /admin (server-rendered, authenticated)
 *
 * The Vue / Nitro story is structurally similar to demo-next-e2e but the
 * proxy and route-protection layers come from `@zitadel/sdk-nuxt`'s Nitro
 * middleware rather than `@zitadel/sdk-next`'s edge middleware.
 * Running the same scenario on both demos is the only way to catch a
 * regression in one SDK without the other.
 *
 * Component / orchestrator behaviour is covered by `packages/components`'s
 * Vitest suite — do not duplicate it here. See `apps/demo-nuxt-e2e/AGENTS.md`.
 */
export default defineConfig({
  testDir: "./src",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  // Boot the mock auth server first so Nitro can proxy to it on the very
  // first request. Direct pnpm filter commands keep these long-running
  // processes outside Moon's task graph; Playwright owns their lifecycle.
  //
  // The api-mock listens on PORT 8081 here so this project can run in
  // parallel with `apps/demo-next-e2e/` (which uses the default 8080).
  // Both api-mock (`bin/start.ts` reads PORT) and
  // the SDKs (ZITADEL_URL) already accept the override; no
  // application code changes.
  webServer: [
    {
      command: "pnpm --filter @zitadel/api-mock start",
      url: "http://localhost:8081/.well-known/jwks.json",
      reuseExistingServer: true,
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: "8081",
      },
    },
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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
