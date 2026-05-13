// @ts-check
import eslint from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import perfectionistPlugin from 'eslint-plugin-perfectionist';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
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
        typescript: { alwaysTryTypes: true },
        node: true,
      },
    },
    rules: {
      'import/no-named-as-default-member': 'off',
      'import/order': 'off',
      'perfectionist/sort-imports': ['error', { type: 'natural' }],
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
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
