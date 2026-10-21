import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/website",
    environment: "node",
    // A Next.js app keeps its code under app/, not src/.
    include: ["app/**/*.spec.ts"],
    coverage: { ...baseTest.coverage, include: ["app/**/*.{ts,tsx}"] },
  },
});
