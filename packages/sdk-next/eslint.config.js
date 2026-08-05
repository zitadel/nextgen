// @ts-check
import eslint from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import prettierPlugin from "eslint-plugin-prettier";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import testingLibraryPlugin from "eslint-plugin-testing-library";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "out-tsc/**", "node_modules/**"] },
  {
    ...eslint.configs.recommended,
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
  },
  tseslint.configs.recommended,
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
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    plugins: {
      perfectionist: perfectionistPlugin,
      prettier: prettierPlugin,
    },
    settings: {
      react: { version: "detect" },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          conditionNames: ["@zitadel/source", "types", "import", "default"],
        },
        node: true,
      },
    },
    rules: {
      "import/no-named-as-default-member": "off",
      "import/order": "off",
      "perfectionist/sort-imports": ["error", { type: "natural" }],
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    ...testingLibraryPlugin.configs["flat/react"],
  },
  prettierConfig,
  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json"],
    language: "json/json",
    ...json.configs.recommended,
  },
  {
    files: ["**/tsconfig*.json"],
    language: "json/jsonc",
    ...json.configs.recommended,
  },
  markdown.configs.recommended,
);
