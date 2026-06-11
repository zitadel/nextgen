import { defineConfig } from "vitest/config";

/**
 * Single Node project. Tokens never run in a browser; the snapshot test
 * just locks the public name set so a Figma sync that renames or removes a
 * token fails CI instead of silently breaking atoms.
 */
export default defineConfig({
  resolve: { conditions: ["@zitadel/source"] },
  test: {
    name: "@zitadel/design-tokens",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
