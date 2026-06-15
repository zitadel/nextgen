// @ts-check
import eslint from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import perfectionistPlugin from 'eslint-plugin-perfectionist';
import prettierPlugin from 'eslint-plugin-prettier';
import qwikPlugin from 'eslint-plugin-qwik';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'lib/**', 'lib-types/**', 'node_modules/**'] },
  {
    ...eslint.configs.recommended,
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
  },
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
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
  {
    // Qwik rules cover the component source; `valid-lexical-scope` needs
    // type-aware linting, so enable the project service for src files only.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { qwik: qwikPlugin.qwikEslint9Plugin },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: qwikPlugin.configs.recommended.rules,
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
