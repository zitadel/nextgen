// @ts-check
import zitadel from "@zitadel/eslint-config";
import playwright from "eslint-plugin-playwright";
import { defineConfig } from "eslint/config";

export default defineConfig({ ignores: ["fixtures/preexisting/**"] }, zitadel, {
  // Playwright-specific checks (missing-await, valid-expect, …) for the
  // journey specs only. The Vitest script tests under `scripts/` stay on the
  // generic base, since the Playwright rules do not apply to them.
  ...playwright.configs["flat/recommended"],
  files: ["src/**/*.spec.ts"],
});
