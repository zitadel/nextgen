import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

export default defineConfig({
  // Resolve sibling `@zitadel/*` workspace packages to their TypeScript
  // source, matching the `customConditions` the repo's tsconfig uses, so
  // tests exercise the same code that ships. Mirrors the convention in
  // `packages/api-mock`, `packages/components`, etc.
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/mock-zitadel",
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: { ...baseTest.coverage, exclude: ["src/**/*.test.ts"] },
  },
});
