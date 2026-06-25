import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve sibling `@zitadel/*` workspace packages to their TypeScript
  // source, matching the `customConditions` the repo's tsconfig uses, so
  // tests exercise the same code that ships. Mirrors the convention in
  // `packages/api-mock`, `packages/components`, etc.
  resolve: { conditions: ["@zitadel/source"] },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
