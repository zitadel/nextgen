import { join } from "node:path";

import { defineConfig } from "@playwright/test";
import { withZitadel } from "@zitadel/testing/playwright";
import {
  chromiumProjects,
  e2eActionTimeouts,
  e2eTimeouts,
  e2eTrace,
  inRepoZitadel,
  realLaneDefaults,
} from "../playwright.shared";

/**
 * The embedded console against a deployment with the platform project
 * bootstrapped — the shape the console is built for (#1300).
 *
 * Same server as `playwright.embedded.config.mts` (the built binary serving
 * the console and the API at one origin, no Vite proxy, no project secret in
 * any console request), but with `platform.bootstrap_project` left at the
 * server default instead of switched off: the console signs people into the
 * platform project, and customer projects are managed through grants. That
 * is what the embedded lane cannot show, because its sign-ins run against the
 * harness's own project.
 *
 * No `app` entry: the instance is the app server (see `withZitadel`).
 */
const appDir = import.meta.dirname;
// A fixed pin, same reasoning as the embedded lane. Neighbors: 8093
// e2e:console-real, 8094 console dev-real, 8095 e2e:console-embedded.
const zitadelPort = Number(process.env.PLATFORM_ZITADEL_PORT ?? 8097);
const origin = `http://localhost:${zitadelPort}`;

export default defineConfig({
  ...e2eTimeouts,
  testDir: "./src-platform",
  ...realLaneDefaults("platform"),
  retries: process.env.CI ? 1 : 0,
  use: {
    ...e2eActionTimeouts,
    baseURL: origin,
    trace: e2eTrace,
  },
  // Sign-up plus a walk over every screen: readiness, not latency, is under
  // test, so give the visibility assertions the embedded lane's headroom.
  expect: { timeout: 10_000 },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin: origin,
    // Own handshake file, so this lane can run next to the others.
    handshakePath: join(appDir, ".zitadel-testing", "handshake-platform.json"),
    zitadel: inRepoZitadel,
  }),
  projects: chromiumProjects,
});
