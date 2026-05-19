import { workspaceRoot } from "@nx/devkit";
import { nxE2EPreset } from "@nx/playwright/preset";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E coverage for the embedded sign-in path on Nuxt:
 *
 *   demo-nuxt /login → <zitadel-login> → /__nextgen proxy
 *                    → api-mock TCP server → __nextgen_session cookie
 *                    → /admin (server-rendered, authenticated)
 *
 * The Vue / Nitro story is structurally similar to demo-next-e2e but the
 * proxy and route-protection layers come from `@nextgen/sdk-nuxt`'s Nitro
 * middleware rather than `@zitadel-nextgen/sdk-next`'s edge middleware.
 * Running the same scenario on both demos is the only way to catch a
 * regression in one SDK without the other.
 *
 * Component / orchestrator behaviour is covered by `packages/components`'s
 * Vitest suite — do not duplicate it here. See `apps/demo-nuxt-e2e/AGENTS.md`.
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.filename, { testDir: "./src" }),
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  // Boot the mock auth server first so Nitro can proxy to it on the very
  // first request. Direct pnpm filter commands (rather than `nx run …`)
  // avoid the `@nx/playwright/plugin` task graph treating these
  // long-running processes as e2e dependencies that must complete first.
  webServer: [
    {
      command: "pnpm --filter @zitadel-nextgen/api-mock start",
      url: "http://localhost:4000/.well-known/jwks.json",
      reuseExistingServer: true,
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @nextgen/demo-nuxt dev",
      url: "http://localhost:3001/login",
      reuseExistingServer: true,
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: {
        NEXTGEN_ISSUER_URL: "http://localhost:4000",
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
