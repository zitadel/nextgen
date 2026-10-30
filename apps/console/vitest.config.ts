import { defineConfig, mergeConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

import viteConfig from "./vite.config";

// Keep test defaults out of the production build's imports and cache key.
export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      ...baseTest,
      name: "@zitadel/console",
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      // A local dotenv fallback must not mask runtime-discovery failures.
      // Specs that need it use vi.stubEnv; unstubEnvs restores these defaults.
      env: {
        VITE_CONSOLE_API_BASE: "http://localhost/api",
        VITE_CONSOLE_RUNTIME_FALLBACK: "",
      },
      unstubEnvs: true,
      // Above RTL's 5s async timeout and the cold router import under CI load.
      testTimeout: 30_000,
    },
  }),
);
