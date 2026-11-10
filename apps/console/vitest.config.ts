import { defineConfig, mergeConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

import viteConfig from "./vite.config";

// Keep test defaults out of the production build's imports and cache key.
export default defineConfig(async (env) =>
  mergeConfig(await viteConfig(env), {
    test: {
      ...baseTest,
      name: "@zitadel/console",
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      // A local dotenv fallback must not mask runtime-discovery failures.
      // Specs that need it use vi.stubEnv; unstubEnvs restores these defaults.
      env: {
        VITE_CONSOLE_API_BASE: "http://localhost",
        VITE_CONSOLE_RUNTIME_FALLBACK: "",
      },
      unstubEnvs: true,
      // Above RTL's 5s async timeout; test setup loads the router before tests.
      testTimeout: 30_000,
    },
  }),
);
