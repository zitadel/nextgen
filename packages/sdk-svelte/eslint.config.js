// @ts-check
import zitadel, { prettier as prettierLast } from "@zitadel/eslint-config";
import sveltePlugin from "eslint-plugin-svelte";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// `.svelte` files are linted by eslint-plugin-svelte (and type-checked by
// `svelte-check`, the `check` script); the shared base covers the `.ts`/`.js`
// surface with the hardened rules.
export default defineConfig(
  zitadel,
  {
    // `.svelte` component imports are resolved by the Svelte toolchain.
    files: ["**/*.{ts,js,mjs,cjs}"],
    rules: { "import/no-unresolved": ["error", { ignore: ["\\.svelte$"] }] },
  },
  // Scope eslint-plugin-svelte strictly to `.svelte` files so its rules
  // (e.g. comment-directive) never run on `.ts`/`.md` without svelte context.
  ...sveltePlugin.configs["flat/recommended"].map((c) => ({
    ...c,
    files: ["**/*.svelte"],
  })),
  {
    // Parse `<script lang="ts">` blocks with the TypeScript parser.
    files: ["**/*.svelte"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  // eslint-config-prettier does not cover `svelte/*` rules, so disable the
  // Svelte formatting rules with the plugin's own prettier config (scoped to
  // `.svelte`), then eslint-config-prettier LAST for the `.ts`/`.js` surface.
  ...sveltePlugin.configs["flat/prettier"].map((c) => ({
    ...c,
    files: ["**/*.svelte"],
  })),
  prettierLast,
);
