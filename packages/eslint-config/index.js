// @ts-check
import eslint from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import prettierPlugin from "eslint-plugin-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

// The ESLint flat-config base shared by every Zitadel SDK package and app.
//
// It carries only what is identical across all of them: the recommended
// JS/TS/import rule sets, the perfectionist + prettier wiring, the hardened
// TypeScript rules, and the JSON/Markdown languages. It deliberately declares
// no top-level `ignores` and no framework plugins (React, Svelte, Solid, Qwik,
// Nuxt, …) — per ESLint guidance, `ignores` are the consumer's responsibility,
// and framework layers are too package-specific to live here. Each consumer
// spreads this base and adds its own `ignores` and framework config on top:
//
//   import { defineConfig } from "eslint/config";
//   import zitadel from "@zitadel/eslint-config";
//
//   export default defineConfig(
//     { ignores: ["dist/**", "node_modules/**"] },
//     zitadel,
//     // …framework-specific blocks…
//   );
//
// The source glob intentionally includes `tsx`/`jsx` so JSX-based consumers are
// covered without overriding the base; packages without JSX simply have no such
// files to match.
const SOURCE_FILES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const TEST_FILES = ["**/*.{test,spec}.{ts,tsx,mts,cts}", "**/__tests__/**/*.{ts,tsx,mts,cts}"];

// Re-exported so consumers that add framework layers (React/Svelte/Solid/Qwik)
// AFTER the base can append it as the FINAL block. eslint-config-prettier only
// turns OFF formatting rules, so placing it last guarantees Prettier wins even
// if a future framework-plugin `recommended` preset starts enabling a
// formatting rule — it never disables correctness rules or `prettier/prettier`.
export const prettier = prettierConfig;

export default tseslint.config(
  {
    // Universal ignores applied in every package (a flat-config block with
    // only `ignores` is global). Covers build output, framework build dirs,
    // coverage/test artifacts, and generated code — none of which should be
    // linted. Consumers add only package-specific ignores on top. Keep this in
    // sync with the repo `.prettierignore` so ESLint and Prettier skip the
    // same files.
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/out-tsc/**",
      "**/.next/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/.svelte-kit/**",
      "**/storybook-static/**",
      "**/coverage/**",
      "**/test-output/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.vitest/**",
      "**/.vercel/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/mockServiceWorker.js",
      "**/*.d.ts",
    ],
  },
  {
    ...eslint.configs.recommended,
    files: SOURCE_FILES,
  },
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: SOURCE_FILES,
    languageOptions: {
      // Node and browser globals (the SDKs and apps run in both), so core
      // globals like `process`, `console`, `URL`, `setTimeout`, `window` and
      // `document` do not trip `no-undef`.
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      perfectionist: perfectionistPlugin,
      prettier: prettierPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          conditionNames: ["@zitadel/source", "types", "import", "default"],
        },
        node: true,
      },
      // The generated `@zitadel/api` SDK bundles its types into multi-megabyte
      // files (one orval-generated zod file alone is ~1MB). eslint-plugin-import
      // re-parses the whole thing on every import to enumerate its exports,
      // which makes linting any consumer pathologically slow (90s+ vs seconds).
      // Exempt only `@zitadel/api` (and its subpaths) from that content parse —
      // `no-unresolved` still verifies the import path resolves, and TypeScript
      // validates the types. The regex is anchored so it does not match
      // `@zitadel/api-mock`.
      "import/ignore": ["@zitadel/api(/|$)"],
    },
    rules: {
      "import/no-named-as-default-member": "off",
      // Noisy and redundant with TypeScript: it flags idiomatic default
      // imports (e.g. `import consola from "consola"`) whenever the module
      // also happens to expose a same-named named export.
      "import/no-named-as-default": "off",
      "import/order": "off",
      // The generated `@zitadel/api` SDK resolves through multi-megabyte,
      // build-time-generated files that the import resolver can't reliably
      // follow across every consumer; TypeScript validates these imports, so
      // exempt the package (and its subpaths) from `no-unresolved`. Paired with
      // the `import/ignore` setting above that skips its export parsing.
      "import/no-unresolved": ["error", { ignore: ["^@zitadel/api(/|$)"] }],
      "perfectionist/sort-imports": ["error", { type: "natural" }],
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // Prefer top-level `import type`, but allow inline `import()` type
      // annotations — they are idiomatic in test and generated files.
      "@typescript-eslint/consistent-type-imports": ["error", { disallowTypeAnnotations: false }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      // Tests routinely use `any` for mocks, fixtures, and parsed JSON.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettierConfig,
  {
    // Build-tool config files (vite/vitest/playwright configs) live at the
    // package root, outside the `src` tsconfig scope, so the import resolver
    // can't follow their imports — even though the tool that loads each file
    // resolves them fine. Their imports are exercised by the tool itself, so
    // skip `no-unresolved` here; every other import rule still applies.
    files: ["**/*.config.{ts,mts,cts}", "**/playwright*.config.{ts,mts,cts}"],
    rules: { "import/no-unresolved": "off" },
  },
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
  {
    // `fenced-code-language` (every code block must declare a language) is
    // stylistic noise for prose docs, and `no-missing-label-refs` false-flags
    // bracket text such as empty `[]` and checkbox syntax as broken link
    // references. Keep the structural Markdown checks, drop these two.
    files: ["**/*.md"],
    rules: {
      "markdown/fenced-code-language": "off",
      "markdown/no-missing-label-refs": "off",
    },
  },
);
