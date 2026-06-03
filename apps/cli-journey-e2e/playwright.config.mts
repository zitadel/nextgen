import { nxE2EPreset } from "@nx/playwright/preset";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.JOURNEY_APP_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  ...nxE2EPreset(import.meta.filename, { testDir: "./src" }),
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "./test-output/playwright/report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "./test-output/playwright/output",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
