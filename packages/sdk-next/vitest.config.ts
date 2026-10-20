import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { baseTest, edgeProject } from "../../vitest.shared.mjs";

// auth.ts imports "server-only", whose default entry throws to keep server
// modules out of client bundles. Tests run outside both module graphs, so
// substitute an empty module (see the stub for details).
const alias = {
  "server-only": fileURLToPath(new URL("./src/__tests__/stubs/server-only.ts", import.meta.url)),
};

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/sdk-next",
    projects: [
      {
        cacheDir: ".vitest/jsdom",
        resolve: { alias },
        test: {
          name: "jsdom",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      // `/middleware` is the SDK's edge entry (see the README), and the JWT
      // helpers it verifies sessions with: both must run in the edge VM.
      edgeProject({
        include: ["src/__tests__/middleware.test.ts", "src/__tests__/lib/jwt.test.ts"],
        alias,
      }),
    ],
  },
});
