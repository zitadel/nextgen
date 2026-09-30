import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * Single Node project. Tokens never run in a browser; the snapshot test
 * just locks the public name set so a Figma sync that renames or removes a
 * token fails CI instead of silently breaking atoms.
 */
export default defineConfig({
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/design-tokens",
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
