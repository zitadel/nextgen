import { defineConfig } from "@playwright/test";
import { nextAppEnv, withZitadel } from "@zitadel/testing/playwright";
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
const zitadelPort = Number(process.env.REAL_ZITADEL_PORT ?? 8092);
const appOrigin = process.env.REAL_APP_ORIGIN ?? "http://localhost:3002";

export default defineConfig({
  ...e2eTimeouts,
  testDir: "./src-real",
  ...realLaneDefaults("real"),
  use: {
    ...e2eActionTimeouts,
    baseURL: appOrigin,
    trace: e2eTrace,
  },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin,
    zitadel: inRepoZitadel,
    app: {
      command: ["corepack", "pnpm", "--filter", "@zitadel/demo-next", "dev"],
      cwd: workspaceRoot,
      readyPath: "/login",
      env: nextAppEnv,
    },
  }),
  projects: chromiumProjects,
});
