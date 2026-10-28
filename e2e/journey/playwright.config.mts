import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.JOURNEY_APP_URL ?? "http://localhost:3000";
const outputDir = process.env.JOURNEY_PLAYWRIGHT_OUTPUT_DIR ?? "./test-output/playwright/output";
const reportDir = process.env.JOURNEY_PLAYWRIGHT_REPORT_DIR ?? "./test-output/playwright/report";

export default defineConfig({
  testDir: "./src",
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: reportDir, open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  outputDir,
  projects: [
    {
      name: "chromium",
      testIgnore: /(schema-revisions|password-policy)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Leaves SSO on and a new schema revision, so it runs after the specs that need a fresh app.
      name: "schema-revisions",
      testMatch: /schema-revisions\.spec\.ts/,
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Deploys and rolls back too, and leaves no password policy, so it runs last.
      name: "password-policy",
      testMatch: /password-policy\.spec\.ts/,
      dependencies: ["schema-revisions"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
