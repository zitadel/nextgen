import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * `cli:check-advisories`: asks the npm advisory database about the package
 * versions the scaffolders pin. It needs the network, so it is not part of
 * `cli:test`; `.github/workflows/scaffold-advisories.yml` runs it nightly and
 * on changes to the scaffolders.
 */
export default defineConfig({
  cacheDir: ".vitest",
  // The scaffolders import `@zitadel/api`; its TypeScript source spares the
  // check a build of it. Under the node environment Vitest resolves through
  // Vite's `ssr` options, so a top-level `resolve.conditions` would not apply.
  ssr: { resolve: { conditions: sourceConditions } },
  test: {
    ...baseTest,
    name: "@zitadel/cli advisories",
    environment: "node",
    include: ["checks/**/*.check.ts"],
    outputFile: { junit: "./test-output/vitest/advisories.junit.xml" },
    // A request the registry drops is not an advisory.
    retry: 2,
  },
});
