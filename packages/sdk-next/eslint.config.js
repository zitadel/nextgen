// @ts-check
import zitadel, { prettier as prettierLast } from "@zitadel/eslint-config";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import testingLibraryPlugin from "eslint-plugin-testing-library";
import { defineConfig } from "eslint/config";

export default defineConfig(
  zitadel,
  { files: ["**/*.{ts,tsx,js,jsx}"], settings: { react: { version: "detect" } } },
  {
    ...reactPlugin.configs.flat.recommended,
    files: ["**/*.{ts,tsx,js,jsx}"],
  },
  {
    ...reactPlugin.configs.flat["jsx-runtime"],
    files: ["**/*.{ts,tsx,js,jsx}"],
  },
  {
    ...reactHooksPlugin.configs["recommended-latest"],
    files: ["**/*.{ts,tsx,js,jsx}"],
  },
  {
    ...jsxA11yPlugin.flatConfigs.recommended,
    files: ["**/*.{tsx,jsx}"],
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    ...testingLibraryPlugin.configs["flat/react"],
  },
  // Keep eslint-config-prettier LAST so Prettier wins over any formatting rule
  // the React layers above might enable now or in a future version.
  prettierLast,
);
