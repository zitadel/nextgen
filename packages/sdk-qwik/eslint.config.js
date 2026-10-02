// @ts-check
import zitadel, { prettier as prettierLast } from "@zitadel/eslint-config";
import qwikPlugin from "eslint-plugin-qwik";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["lib/**", "lib-types/**"] },
  zitadel,
  {
    // Qwik rules cover the component source; `valid-lexical-scope` needs
    // type-aware linting, so enable the project service for src files only.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { qwik: qwikPlugin.qwikEslint9Plugin },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: qwikPlugin.configs.recommended.rules,
  },
  // eslint-config-prettier LAST so Prettier wins over the Qwik layer.
  prettierLast,
);
