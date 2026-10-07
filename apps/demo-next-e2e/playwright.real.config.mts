import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { nextAppEnv, withZitadel } from "@zitadel/testing/playwright";

/**
 * Real-instance variant of the embedded sign-in e2e:
 *
 *   withZitadel() generates the two webServer entries — one boots an
 *   ephemeral seeded Zitadel and writes a handshake file, the other waits for
 *   it and starts demo-next with that instance's project env. Tests mint
 *   their own users per test via the @zitadel/testing/playwright fixtures, so
 *   they run fully parallel on the one shared instance.
 *
 * The api-mock suite in playwright.config.mts stays the fast default; this
 * config is the fidelity check against the real server.
 */
const appDir = import.meta.dirname;
const workspaceRoot = join(appDir, "../..");
const zitadelPort = Number(process.env.REAL_ZITADEL_PORT ?? 8092);
const appOrigin = process.env.REAL_APP_ORIGIN ?? "http://localhost:3002";

export default defineConfig({
  testDir: "./src-real",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
  },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin,
    zitadel: {
      // In-repo runs use the source-built binary; run `moon run server:build`
      // first (the moon task wires this env var).
      serverBinary:
        process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
      serverBinaryHint: "run `moon run server:build` first.",
    },
    app: {
      // demo-next's `dev` script, run as next's CLI under node: a nested pnpm
      // would warn about the platform-specific server packages, `node --run`
      // does not pass the runner's SIGTERM on (orphaning next), and the
      // `.bin` shim is a `.cmd` on Windows that spawn cannot start.
      command: [
        process.execPath,
        join(workspaceRoot, "apps", "demo-next", "node_modules", "next", "dist", "bin", "next"),
        "dev",
        "--port",
        "3002",
      ],
      cwd: join(workspaceRoot, "apps", "demo-next"),
      readyPath: "/login",
      env: nextAppEnv,
    },
  }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
