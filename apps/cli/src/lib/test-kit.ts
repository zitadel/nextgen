import type { GitignoreRule } from "@/lib/gitignore";
import { isObject, parseJsonObject, setTopLevelJsonKey } from "@/lib/json";
import type { ScaffoldPlan } from "@/lib/orca/patchers/rule/file-writer/types";
import { sdkVersionForCli } from "@/lib/public-cli";

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
 * Every name Playwright looks for its config under, in its own order. A
 * second config leaves which one runs to that order.
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
 * The test of the sign-in itself, in the suite's `testDir`.
 */
export const SIGN_IN_SPEC = "e2e/sign-in.spec.ts";

/**
 * The test to copy: a page behind the sign-in, started signed in.
 */
export const SIGNED_IN_SPEC = "e2e/signed-in.spec.ts";

/**
 * The `package.json` script that runs the suite, and what it runs.
 */
export const TEST_SCRIPT = { name: "test:e2e", command: "playwright test" } as const;

/**
 * What a test run leaves in the app, kept out of git: the kit's handshake
 * file, which holds the test project's secret, and Playwright's results and
 * report, each named by a file the run writes in it.
 */
export const TEST_RUN_OUTPUTS: ReadonlyArray<GitignoreRule> = [
  { path: ".zitadel-testing/handshake.json", ignored: true, entry: ".zitadel-testing/" },
  { path: "test-results/.last-run.json", ignored: true, entry: "test-results/" },
  { path: "playwright-report/index.html", ignored: true, entry: "playwright-report/" },
];

/**
 * The variables that move the run's two ports, and their defaults: apart
 * from the dev server's (3000), the local runtime's (8080 on) and the repo's
 * own e2e lanes', so a run collides with none of them.
 */
export const TEST_PORTS = {
  app: { variable: "ZITADEL_TEST_APP_PORT", port: 3100 },
  server: { variable: "ZITADEL_TEST_SERVER_PORT", port: 8090 },
} as const;

/**
 * What a framework's suite needs: how to start its dev server, and the kit's
 * env template for it. The sign-in page, `/login`, and the protected page,
 * `/profile`, are the same in every app setup scaffolds.
 */
type FrameworkSuite = Readonly<{
  /** The kit's env template, as `@zitadel/testing/playwright` exports it. */
  envTemplate: string;
  /** The dev server's argv, to which the app's port is appended. */
  devCommand: ReadonlyArray<string>;
}>;

/**
 * The frameworks a suite can be added for. Each one is the shape the
 * journey's testkit lane runs; a framework joins once that lane runs it.
 */
const SUITES: Readonly<Record<string, FrameworkSuite>> = {
  next: {
    envTemplate: "nextAppEnv",
    devCommand: ["npx", "next", "dev", "--hostname", "localhost", "--port"],
  },
};

/**
 * The frameworks {@link testSuitePlan} supports, for a refusal to list.
 */
export const TEST_SUITE_FRAMEWORKS: ReadonlyArray<string> = Object.keys(SUITES);

/**
 * Whether a suite can be added for the framework setup recorded.
 *
 * @param framework - The framework id from `zitadel.json`.
 * @returns Whether {@link testSuitePlan} supports it.
 */
export function supportsTestSuite(framework: string): boolean {
  return Object.hasOwn(SUITES, framework);
}

/**
 * The files, dependencies and script of a first Playwright suite on the kit.
 *
 * @param input - The framework setup configured, the CLI's version (the kit
 *   is pinned to it as setup pins the SDK), and the dependencies and scripts
 *   the app already declares, which the plan leaves as they are.
 * @returns The plan for the file writer.
 * @throws {@link Error} When the framework has no suite; check
 *   {@link supportsTestSuite} first.
 */
export function testSuitePlan(input: {
  framework: string;
  cliVersion: string;
  declared: ReadonlySet<string>;
  scripts: ReadonlySet<string>;
}): ScaffoldPlan {
  const suite = SUITES[input.framework];
  if (suite === undefined) {
    throw new Error(`no test suite for framework ${input.framework}`);
  }
  return {
    ops: [
      { kind: "write", path: PLAYWRIGHT_CONFIG, contents: playwrightConfig(suite) },
      { kind: "mkdir", path: "e2e" },
      { kind: "write", path: SIGN_IN_SPEC, contents: SIGN_IN },
      { kind: "write", path: SIGNED_IN_SPEC, contents: SIGNED_IN },
      { kind: "append-gitignore", rules: TEST_RUN_OUTPUTS },
      ...(input.scripts.has(TEST_SCRIPT.name)
        ? []
        : [{ kind: "edit", path: "package.json", edit: withTestScript } as const]),
      {
        kind: "add-dep",
        name: TEST_KIT_PACKAGE,
        version: sdkVersionForCli(input.cliVersion),
        dev: true,
      },
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
    ],
    summary: [{ title: "Test suite", detail: `A Playwright suite on ${TEST_KIT_PACKAGE}.` }],
  };
}

function playwrightConfig(suite: FrameworkSuite): string {
  const command = suite.devCommand
    .map((arg) => {
      return JSON.stringify(arg);
    })
    .join(", ");
  const { app, server } = TEST_PORTS;
  return `import { defineConfig } from "@playwright/test";
import { ${suite.envTemplate}, withZitadel } from "${TEST_KIT_PACKAGE}/playwright";

// Each run boots its own Zitadel server and project, and stops it when it ends.
// Both ports are apart from the dev server's and the local runtime's; set
// ${app.variable} or ${server.variable} to move them.
const appPort = Number(process.env.${app.variable} ?? ${app.port});
const appOrigin = \`http://localhost:\${appPort}\`;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
  },
  ...withZitadel({
    configDir: import.meta.dirname,
    port: Number(process.env.${server.variable} ?? ${server.port}),
    appOrigin,
    app: {
      command: [${command}, String(appPort)],
      cwd: import.meta.dirname,
      readyPath: "/login",
      env: ${suite.envTemplate},
    },
  }),
});
`;
}

/** The test of the sign-in itself. */
const SIGN_IN = `import { expect, loginWithPassword, test } from "${TEST_KIT_PACKAGE}/playwright";

test("a seeded user signs in with their password", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("/login");
  await loginWithPassword(page, user);

  await expect(page).toHaveURL(/\\/profile(?:[/?#]|$)/, { timeout: 30_000 });
});
`;

/** The test to copy: a page behind the sign-in, started signed in. */
const SIGNED_IN = `import { expect, test } from "${TEST_KIT_PACKAGE}/playwright";

// Test the sign-in itself with the signed-out \`page\`, as sign-in.spec.ts does.
// Test every other page from \`authenticatedPage\`: it starts signed in as a new user.
test("a signed-in user sees the profile page", async ({ authenticatedPage }) => {
  const { page } = authenticatedPage;

  await page.goto("/profile");

  await expect(page).toHaveURL(/\\/profile(?:[/?#]|$)/);
  await expect(page.getByTestId("zitadel-session-logout")).toBeVisible({ timeout: 30_000 });
});
`;

/**
 * Adds {@link TEST_SCRIPT} to `package.json`, splicing in the one key so every
 * other byte of the developer's file stays as it is.
 */
function withTestScript(source: string | undefined): string {
  const text = source ?? "{}";
  const document = parseJsonObject(text, "package.json");
  const scripts = isObject(document.scripts) ? document.scripts : {};
  if (Object.hasOwn(scripts, TEST_SCRIPT.name)) {
    return text;
  }
  return setTopLevelJsonKey(text, "package.json", "scripts", {
    ...scripts,
    [TEST_SCRIPT.name]: TEST_SCRIPT.command,
  });
}
