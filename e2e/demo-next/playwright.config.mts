import { defineConfig } from "@playwright/test";
import {
  apiMockServer,
  chromiumProjects,
  e2eActionTimeouts,
  e2eTimeouts,
  e2eTrace,
  workspaceRoot,
} from "../playwright.shared";

/**
 * E2E coverage for the embedded sign-in path:
 *
 *   demo-next /login → <zitadel-login> → /__nextgen proxy
 *                    → api-mock TCP server → the project's session cookie
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
  ...e2eTimeouts,
  testDir: "./src",
  outputDir: "test-results/mock",
  use: {
    ...e2eActionTimeouts,
    baseURL: "http://localhost:3002",
    trace: e2eTrace,
  },
  // The mock auth server first, then the Next dev server against it.
  // `reuseExistingServer` lets developers run either server manually and
  // have Playwright skip its own boot.
  //
  // Direct pnpm filter commands keep these long-running processes outside
  // Moon's task graph; Playwright owns their lifecycle for this e2e suite.
  webServer: [
    apiMockServer(8080),
    {
      command: "pnpm --filter @zitadel/demo-next dev",
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
  projects: chromiumProjects,
});
