import type { FileOp, ScaffoldPlan } from "@/lib/orca/patchers/rule/file-writer/types";

/**
 * The test kit `tests add` wires an app to.
 */
export const TEST_KIT_PACKAGE = "@zitadel/testing";

/**
 * The test runner the kit's fixtures extend.
 */
export const PLAYWRIGHT_PACKAGE = "@playwright/test";

/**
 * The Playwright range a new suite installs: the kit's peer floor, as a caret
 * range so the app's package manager picks the newest compatible release.
 */
export const PLAYWRIGHT_RANGE = "^1.60.0";

/**
 * The config file the suite is run from. `.mts`, so Node loads it as an ES
 * module, which `import.meta.dirname` needs in an app whose `package.json`
 * has no `"type": "module"`.
 */
export const PLAYWRIGHT_CONFIG = "playwright.config.mts";

/**
 * Every name Playwright looks for its config under, in its own order: an app
 * that already has one of the others runs that one and never this suite's.
 */
export const PLAYWRIGHT_CONFIG_NAMES = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mts",
  "playwright.config.mjs",
  "playwright.config.cts",
  "playwright.config.cjs",
] as const;

/**
 * The first test, in the suite's `testDir`.
 */
export const SIGN_IN_SPEC = "e2e/sign-in.spec.ts";

/**
 * What a test run leaves in the app: the kit's handshake file, which holds the
 * test project's secret, and Playwright's results and report.
 */
export const TEST_RUN_OUTPUTS = [".zitadel-testing/", "test-results/", "playwright-report/"];

/**
 * The port the kit's own Zitadel server listens on during a run, apart from
 * the local runtime's, which starts at 8080.
 */
export const TEST_SERVER_PORT = 8092;

/**
 * The port the run serves the app on, apart from the dev server's, so a run
 * never collides with a dev server that is already up.
 */
export const TEST_APP_PORT = 3100;

/**
 * What the suite needs to know about a framework: how to start its dev server
 * on a port, and where its sign-in lands.
 */
type FrameworkSuite = Readonly<{
  /** The display name a refusal uses. */
  name: string;
  /** The kit's env template for the framework, as exported by `@zitadel/testing/playwright`. */
  envTemplate: string;
  /** The dev server's argv, serving the app on {@link TEST_APP_PORT}. */
  devCommand: ReadonlyArray<string>;
  /** The sign-in page setup writes. */
  loginPath: string;
  /** Where a completed sign-in lands. */
  signedInPath: string;
}>;

/**
 * The frameworks a suite can be added for. Each one is the shape an
 * end-to-end lane runs against the published kit; a framework joins once one
 * does.
 */
const SUITES: Readonly<Record<string, FrameworkSuite>> = {
  next: {
    name: "Next.js",
    envTemplate: "nextAppEnv",
    devCommand: ["npx", "next", "dev", "--hostname", "localhost", "--port", String(TEST_APP_PORT)],
    loginPath: "/login",
    signedInPath: "/profile",
  },
};

/**
 * The frameworks {@link testSuitePlan} supports, for a refusal to list.
 */
export const TEST_SUITE_FRAMEWORKS: ReadonlyArray<string> = Object.keys(SUITES);

/**
 * Whether a suite can be added for the framework setup recorded.
 *
 * @param framework - The framework id from `.zitadel/state.json`.
 * @returns Whether {@link testSuitePlan} supports it.
 */
export function supportsTestSuite(framework: string): boolean {
  return Object.hasOwn(SUITES, framework);
}

/**
 * The files and dependencies of a first Playwright suite on the test kit.
 *
 * @param input - The framework setup configured, the kit version to pin (the
 *   CLI's own, as setup pins the SDK), and the dev dependencies the app
 *   already declares, which the plan leaves as they are.
 * @returns The plan for the file writer.
 * @throws {@link Error} When the framework has no suite; check
 *   {@link supportsTestSuite} first.
 */
export function testSuitePlan(input: {
  framework: string;
  kitVersion: string;
  declared: ReadonlySet<string>;
}): ScaffoldPlan {
  const suite = SUITES[input.framework];
  if (suite === undefined) {
    throw new Error(`no test suite for framework ${input.framework}`);
  }
  const dependencies: FileOp[] = [
    { kind: "add-dep", name: TEST_KIT_PACKAGE, version: input.kitVersion, dev: true },
    ...(input.declared.has(PLAYWRIGHT_PACKAGE)
      ? []
      : [
          {
            kind: "add-dep",
            name: PLAYWRIGHT_PACKAGE,
            version: PLAYWRIGHT_RANGE,
            dev: true,
          } as const,
        ]),
  ];
  return {
    ops: [
      { kind: "write", path: PLAYWRIGHT_CONFIG, contents: playwrightConfig(suite) },
      { kind: "mkdir", path: "e2e" },
      { kind: "write", path: SIGN_IN_SPEC, contents: signInSpec(suite) },
      { kind: "append-gitignore", entries: TEST_RUN_OUTPUTS },
      ...dependencies,
    ],
    summary: [
      {
        title: "Test suite",
        detail: `A Playwright suite on ${TEST_KIT_PACKAGE} for the ${suite.name} app.`,
      },
    ],
  };
}

/**
 * The name a refusal gives the framework.
 *
 * @param framework - A framework id.
 * @returns Its display name, or the id when it has no suite.
 */
export function frameworkName(framework: string): string {
  return SUITES[framework]?.name ?? framework;
}

function playwrightConfig(suite: FrameworkSuite): string {
  return `import { defineConfig } from "@playwright/test";
import { ${suite.envTemplate}, withZitadel } from "${TEST_KIT_PACKAGE}/playwright";

// Each run boots its own Zitadel server and project, and stops it when it ends.
// The app runs on a port of its own, so a running dev server is no obstacle.
const appOrigin = "http://localhost:${TEST_APP_PORT}";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
  },
  ...withZitadel({
    configDir: import.meta.dirname,
    // The test server's port: keep it apart from the local runtime's.
    port: ${TEST_SERVER_PORT},
    appOrigin,
    app: {
      command: [${suite.devCommand.map((arg) => JSON.stringify(arg)).join(", ")}],
      cwd: import.meta.dirname,
      readyPath: "${suite.loginPath}",
      env: ${suite.envTemplate},
    },
  }),
});
`;
}

function signInSpec(suite: FrameworkSuite): string {
  return `import { expect, loginWithPassword, test } from "${TEST_KIT_PACKAGE}/playwright";

// seed.user() creates a user on the run's own server, ready to sign in.
test("a seeded user signs in with their password", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("${suite.loginPath}");
  await loginWithPassword(page, user);

  await expect(page).toHaveURL(/\\${suite.signedInPath}(?:[/?#]|$)/, { timeout: 30_000 });
});
`;
}
