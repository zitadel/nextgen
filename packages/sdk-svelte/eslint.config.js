// @ts-check
import eslint from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import perfectionistPlugin from 'eslint-plugin-perfectionist';
import prettierPlugin from 'eslint-plugin-prettier';
import sveltePlugin from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

// `.svelte` files are linted by eslint-plugin-svelte (and type-checked by
// `svelte-check`, the `check` script); ESLint also covers the `.ts`/`.js`
// surface with the hardened rules shared across the SPA SDKs.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.svelte-kit/**'] },
  {
    ...eslint.configs.recommended,
    files: ['**/*.{ts,js,mjs,cjs}'],
  },
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ['**/*.{ts,js,mjs,cjs}'],
    plugins: {
      perfectionist: perfectionistPlugin,
      prettier: prettierPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          conditionNames: ['@zitadel/source', 'types', 'import', 'default'],
        },
        node: true,
      },
    },
    rules: {
      'import/no-named-as-default-member': 'off',
      'import/order': 'off',
      // `.svelte` component imports are resolved by the Svelte toolchain.
      'import/no-unresolved': ['error', { ignore: ['\\.svelte$'] }],
      'perfectionist/sort-imports': ['error', { type: 'natural' }],
      'prettier/prettier': 'error',
      // Hardened (consistent across all SPA SDKs):
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  // Scope eslint-plugin-svelte strictly to `.svelte` files so its rules
  // (e.g. comment-directive) never run on `.ts`/`.md` without svelte context.
  ...sveltePlugin.configs['flat/recommended'].map((c) => ({
    ...c,
    files: ['**/*.svelte'],
  })),
  {
    // Parse `<script lang="ts">` blocks with the TypeScript parser.
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettierConfig,
  {
    files: ['**/*.json'],
    ignores: ['**/tsconfig*.json'],
    language: 'json/json',
    ...json.configs.recommended,
  },
  {
    files: ['**/tsconfig*.json'],
    language: 'json/jsonc',
    ...json.configs.recommended,
  },
  markdown.configs.recommended,
);
