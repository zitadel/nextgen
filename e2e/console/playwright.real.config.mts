import { defineConfig } from "@playwright/test";
import { withZitadel, type AppEnvTemplate } from "@zitadel/testing/playwright";
import {
  chromiumProjects,
  e2eActionTimeouts,
  e2eTimeouts,
  e2eTrace,
  inRepoZitadel,
  realLaneDefaults,
  workspaceRoot,
} from "../playwright.shared";

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
const zitadelPort = Number(process.env.REAL_ZITADEL_PORT ?? 8093);
const consoleOrigin = process.env.REAL_CONSOLE_ORIGIN ?? "http://localhost:5174";

/**
 * The console reads console-shaped env names: the Vite proxy needs the
 * backend, and nothing else. The project it signs into comes from the
 * instance's `/console/runtime.json` (its first-created project, the harness
 * one), as in production. No credential: the browser authenticates with the
 * signed-in user's session cookie (#1300), and the specs grant that user
 * access through the API (`support/sign-in.ts`).
 */
const consoleAppEnv: AppEnvTemplate = {
  CONSOLE_BACKEND_URL: "baseUrl",
};

export default defineConfig({
  ...e2eTimeouts,
  testDir: "./src-real",
  ...realLaneDefaults("real"),
  retries: process.env.CI ? 1 : 0,
  use: {
    ...e2eActionTimeouts,
    baseURL: consoleOrigin,
    trace: e2eTrace,
  },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin: consoleOrigin,
    zitadel: inRepoZitadel,
    app: {
      command: ["corepack", "pnpm", "--filter", "@zitadel/console", "dev"],
      cwd: workspaceRoot,
      readyPath: "/projects",
      env: consoleAppEnv,
      gracefulShutdownMs: 10_000,
    },
  }),
  projects: chromiumProjects,
});
