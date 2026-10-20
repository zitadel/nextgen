import { defineConfig } from "@playwright/test";

/** The config `tests/unit/shadow-roots-browser.test.ts` runs the spec with. */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  reporter: "line",
  use: { baseURL: "http://localhost:1", browserName: "chromium" },
});
