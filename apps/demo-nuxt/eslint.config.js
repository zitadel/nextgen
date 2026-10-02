// @ts-check
import zitadel, { prettier as prettierLast } from "@zitadel/eslint-config";
import pluginVue from "eslint-plugin-vue";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  zitadel,
  {
    // Nuxt generates its tsconfig (`.nuxt/tsconfig.json`) at build time, so at
    // lint time the import resolver crashes trying to read it, and Nuxt's
    // virtual modules (`#imports`, `#app`, `~` aliases) are unresolvable by a
    // static resolver anyway. Turn off the resolver-backed import rules here;
    // TypeScript (via `nuxi prepare` + vue-tsc) validates these imports. Every
    // rule that would invoke the resolver is disabled, so eslint-plugin-import
    // never initializes it and never tries to read the absent tsconfig.
    rules: {
      "import/no-unresolved": "off",
      "import/named": "off",
      "import/namespace": "off",
      "import/default": "off",
      "import/export": "off",
      "import/no-duplicates": "off",
    },
  },
  // Vue SFCs: lint <template> + <script> with the official plugin. Scope every
  // block strictly to `.vue` (the preset's base block has no `files` filter and
  // would otherwise try to run vue rules on package.json/.ts and crash), and
  // parse `<script lang="ts">` with the TypeScript parser. `prettierLast`
  // (eslint-config-prettier) comes AFTER so Prettier owns template formatting —
  // vue/recommended enables stylistic rules that would otherwise fight it.
  ...pluginVue.configs["flat/recommended"].map((c) => ({
    ...c,
    files: ["**/*.vue"],
  })),
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // Nuxt's file-based routing requires single-word names for pages, layouts
    // and the root `app.vue`, so `multi-word-component-names` is a false
    // positive there (it still applies to reusable components/).
    files: ["**/pages/**/*.vue", "**/layouts/**/*.vue", "**/app.vue", "**/error.vue"],
    rules: { "vue/multi-word-component-names": "off" },
  },
  prettierLast,
);
