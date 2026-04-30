// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import importPlugin from 'eslint-plugin-import';
import perfectionistPlugin from 'eslint-plugin-perfectionist';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  // ── JavaScript + TypeScript ─────────────────────────────────────────────────
  eslint.configs.recommended,
  tseslint.configs.recommended,

  // ── Imports ─────────────────────────────────────────────────────────────────
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,

  // ── Shared rules ────────────────────────────────────────────────────────────
  {
    plugins: {
      prettier: prettierPlugin,
      perfectionist: perfectionistPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
        node: true,
      },
    },
    rules: {
      'prettier/prettier': 'error',
      /** Replaced by perfectionist/sort-imports for consistent cross-file ordering. */
      'import/order': 'off',
      /** Enforces natural alphabetical import grouping. */
      'perfectionist/sort-imports': ['error', { type: 'natural' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },

  // ── Prettier (must be last to disable conflicting formatting rules) ──────────
  prettierConfig,

  // ── JSON ────────────────────────────────────────────────────────────────────
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

  // ── Markdown ────────────────────────────────────────────────────────────────
  {
    files: ['**/*.md'],
    language: 'markdown/gfm',
    ...markdown.configs.recommended,
  },
);
