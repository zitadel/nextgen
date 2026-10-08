import { defineConfig } from "tsdown";

/**
 * Build for `@zitadel/api-mock`. Never published; it builds like the other
 * workspace packages so consumers resolve it from `dist` and its moon `build`
 * task has outputs.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "openid-configuration": "src/openid-configuration.ts",
    "platform-handlers": "src/platform-handlers.ts",
    "public-dir": "src/public-dir.ts",
    server: "src/server.ts",
    vitest: "src/vitest.ts",
    "vitest-browser": "src/vitest-browser.ts",
  },
  outDir: "dist",
  format: ["esm"],
  failOnWarn: true,
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  deps: { neverBundle: ["msw", "vitest", "zod"] },
});
