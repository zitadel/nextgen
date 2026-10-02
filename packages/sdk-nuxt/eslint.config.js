// @ts-check
import nuxtPlugin from "@nuxt/eslint-plugin";
import zitadel from "@zitadel/eslint-config";
import { defineConfig } from "eslint/config";

export default defineConfig(zitadel, {
  files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
  plugins: { nuxt: nuxtPlugin },
  // `#` aliases and `@nuxt/` virtual modules are resolved by Nuxt.
  rules: { "import/no-unresolved": ["error", { ignore: ["^#", "^@nuxt/"] }] },
});
