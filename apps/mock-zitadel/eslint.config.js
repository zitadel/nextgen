// @ts-check
import zitadel from "@zitadel/eslint-config";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["public/**"] },
  zitadel,
  {
    // Generated mock sources import from paths the resolver cannot follow.
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: { "import/no-unresolved": "off" },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
