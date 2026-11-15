import { readFileSync } from "node:fs";
import { join } from "node:path";

import { devices, type PlaywrightTestConfig } from "@playwright/test";
import { type AppEnvTemplate, withZitadel } from "@zitadel/testing/playwright";

/**
 * A fixture's `conformance` field in its package.json, its whole contract: the
 * framework `zitadel setup` scaffolds it for and its fixed ports. The
 * generator (`conformance-fixture generate`) reads the same field, so the app
 * port it was set up for and the one the lane runs it on cannot drift apart.
 */
export interface FixtureSettings {
  framework: string;
  /** The app's dev-server port: `setup --dev-port`, and the kit's app origin. */
  appPort: number;
  /** The kit's Zitadel port in the lane. */
  zitadelPort: number;
  /**
   * The port of the server the generator sets the app up against: not the
   * lane's, so the drift check and the lane can run side by side.
   */
  generatePort: number;
  /**
   * `false` for a framework generator its pin does not fix (it fetches a
   * template or asks npm for `latest`): its drift check runs nightly only.
   */
  generatorPinned?: boolean;
}

export function readFixtureSettings(fixtureDir: string): FixtureSettings {
  const manifest = JSON.parse(readFileSync(join(fixtureDir, "package.json"), "utf8")) as {
    conformance?: FixtureSettings;
  };
  if (!manifest.conformance) {
    throw new Error(`${fixtureDir}/package.json has no "conformance" field`);
  }
  return manifest.conformance;
}

/** The repository root, where the source-built server binary lives. */
const workspaceRoot = join(import.meta.dirname, "..", "..", "..");

/**
 * The Playwright config of one fixture: the kit boots a fresh server and
 * project on the fixture's Zitadel port and runs the app's own `dev` script
 * on its app port, with the project's id, address and secret from `env`.
 * Nothing the fixture commits names a project: the env is all it gets.
 */
export function conformanceConfig(options: {
  configDir: string;
  env: AppEnvTemplate;
}): PlaywrightTestConfig {
  const { appPort, zitadelPort } = readFixtureSettings(options.configDir);
  const appOrigin = `http://localhost:${appPort}`;
  return {
    testDir: ".",
    testMatch: "conformance.spec.ts",
    timeout: 60_000,
    globalTimeout: 600_000,
    fullyParallel: false,
    workers: 1,
    forbidOnly: true,
    outputDir: "test-results",
    reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
    use: {
      baseURL: appOrigin,
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
      trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    ...withZitadel({
      configDir: options.configDir,
      port: zitadelPort,
      appOrigin,
      zitadel: {
        serverBinary:
          process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
        serverBinaryHint: "run `turbo run build --filter=@zitadel/server` first.",
      },
      app: {
        command: ["corepack", "pnpm", "run", "dev"],
        cwd: options.configDir,
        readyPath: "/login",
        env: options.env,
      },
    }),
  };
}
