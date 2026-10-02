// @ts-check
import zitadel, { prettier as prettierLast } from "@zitadel/eslint-config";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import testingLibraryPlugin from "eslint-plugin-testing-library";
import { defineConfig } from "eslint/config";

export default defineConfig(
  zitadel,
  {
    // `@/*` → `src/*` is a Vite alias (the shadcn/ui convention) used across
    // the console. The import resolver only understands tsconfig paths, not
    // bundler aliases, so exempt `@/` from no-unresolved — Vite resolves it at
    // build time and TypeScript validates the types.
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: { "import/no-unresolved": ["error", { ignore: ["^@/"] }] },
  },
  {
    // Root-level `.mts` tooling (the Vite config and dev scripts) import
    // build-only deps the resolver can't follow from outside the src tsconfig
    // scope; the tools load them fine and TypeScript validates them.
    files: ["**/*.{mts,cts}"],
    rules: { "import/no-unresolved": "off" },
  },
  // React layer for the console's TSX surface (same preset as the SDK React
  // packages): React recommended + jsx-runtime, Hooks, JSX a11y, and Testing
  // Library rules for tests.
  { files: ["**/*.{ts,tsx,js,jsx}"], settings: { react: { version: "detect" } } },
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
  {
    // The console predates a11y linting — its previous oxlint setup ran no
    // jsx-a11y rules — so it carries pre-existing violations, most of them in
    // the vendored shadcn/ui primitives under `src/components/ui`. Surface
    // jsx-a11y as warnings so the migration enforces the rules on new code
    // without failing on that backlog; the warnings should be driven down and
    // the rules promoted back to errors.
    files: ["**/*.{tsx,jsx}"],
    rules: Object.fromEntries(
      Object.keys(jsxA11yPlugin.flatConfigs.recommended.rules ?? {}).map((rule) => [rule, "warn"]),
    ),
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    ...testingLibraryPlugin.configs["flat/react"],
  },
  // Keep eslint-config-prettier LAST so Prettier wins over any formatting rule
  // the React layers above might enable now or in a future version.
  prettierLast,
);
