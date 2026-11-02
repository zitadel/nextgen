import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/api",
    environment: "node",
    // The generator's own tests, beside the client's.
    include: [...(baseTest.include ?? []), "scripts/**/*.spec.ts"],
  },
});
