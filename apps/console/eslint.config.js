// @ts-check
import zitadel from "@zitadel/eslint-config";
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
);
