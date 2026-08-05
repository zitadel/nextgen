import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { withZitadel, type AppEnvTemplate } from "@zitadel/testing/playwright";

/**
 * Real-instance console coverage:
 *
 *   withZitadel() generates the two webServer entries — one boots and
 *   bootstraps an ephemeral Zitadel instance, the other maps its handle to
 *   the console's Vite proxy environment and starts the dev server.
 *
 * The existing config remains the production embed-base smoke test. This
 * config exercises live resource pages through the server-side dev proxy.
 */
const appDir = import.meta.dirname;
const workspaceRoot = join(appDir, "../..");
const zitadelPort = Number(process.env.REAL_ZITADEL_PORT ?? 8093);
const consoleOrigin = process.env.REAL_CONSOLE_ORIGIN ?? "http://localhost:5174";

/**
 * The console reads console-shaped env names: the Vite proxy needs the
 * backend and the operator credential, the client pins the project id.
 */
const consoleAppEnv: AppEnvTemplate = {
  VITE_CONSOLE_PROJECT_ID: "projectId",
  CONSOLE_PROJECT_SECRET: "projectSecret",
  CONSOLE_BACKEND_URL: "baseUrl",
};

export default defineConfig({
  testDir: "./src-real",
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/real",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/real" }]],
  use: {
    baseURL: consoleOrigin,
    trace: "on-first-retry",
  },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin: consoleOrigin,
    zitadel: {
      // In-repo runs use the source-built binary; run `moon run server:build`
      // first (the moon task wires this env var).
      serverBinary:
        process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
      serverBinaryHint: "run `moon run server:build` first.",
    },
    app: {
      command: ["corepack", "pnpm", "--filter", "@zitadel/console", "dev"],
      cwd: workspaceRoot,
      readyPath: "/projects",
      env: consoleAppEnv,
      gracefulShutdownMs: 10_000,
    },
  }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
