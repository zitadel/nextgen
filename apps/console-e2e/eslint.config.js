// @ts-check
import zitadel from "@zitadel/eslint-config";
import playwright from "eslint-plugin-playwright";
import { defineConfig } from "eslint/config";

export default defineConfig(zitadel, {
  // Playwright-specific checks (missing-await, valid-expect, …) for the specs.
  ...playwright.configs["flat/recommended"],
  files: ["**/*.spec.ts"],
});
