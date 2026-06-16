import { nxE2EPreset } from "@nx/playwright/preset";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.JOURNEY_APP_URL ?? "http://localhost:3000";
const outputDir =
  process.env.JOURNEY_PLAYWRIGHT_OUTPUT_DIR ?? "./test-output/playwright/output";
const reportDir =
  process.env.JOURNEY_PLAYWRIGHT_REPORT_DIR ?? "./test-output/playwright/report";

export default defineConfig({
  ...nxE2EPreset(import.meta.filename, { testDir: "./src" }),
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
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
