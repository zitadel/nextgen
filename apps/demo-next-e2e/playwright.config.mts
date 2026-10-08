import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const apiMockDir = resolve(workspaceRoot, "packages", "api-mock");
const demoDir = resolve(workspaceRoot, "apps", "demo-next");

// Runs a package's CLI under this node rather than through its package script:
// a script would hide a step from Moon's task graph, `node --run` does not pass
// the runner's SIGTERM on, and the `.bin` shims are `.cmd` files on Windows.
const nodeCli = (cli: string, ...args: string[]) =>
  [process.execPath, cli, ...args].map((arg) => `"${arg}"`).join(" ");

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
  // These are api-mock's `start` and demo-next's `dev` scripts. Playwright owns
  // the long-running processes; what they need built is the e2e task's deps.
  webServer: [
    {
      command: nodeCli(
        resolve(apiMockDir, "node_modules", "tsx", "dist", "cli.mjs"),
        "bin/start.ts",
      ),
      url: "http://localhost:8080/.well-known/jwks.json",
      reuseExistingServer: true,
      cwd: apiMockDir,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: nodeCli(
        resolve(demoDir, "node_modules", "next", "dist", "bin", "next"),
        "dev",
        "--port",
        "3002",
      ),
      url: "http://localhost:3002/login",
      reuseExistingServer: true,
      cwd: demoDir,
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
