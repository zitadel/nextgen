import { defineConfig } from "vitest/config";

import { baseTest, edgeProject } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-sveltekit",
    projects: [
      {
        cacheDir: ".vitest/node",
        test: {
          name: "node",
          globals: true,
          environment: "node",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      // The `/server` entry is what runs on the edge, with the JWT helpers it
      // verifies sessions with: both must run in the edge VM.
      edgeProject({ include: ["src/__tests__/handle.test.ts", "src/__tests__/lib/jwt.test.ts"] }),
    ],
  },
});
