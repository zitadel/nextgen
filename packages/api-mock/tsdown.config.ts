import { defineConfig } from "tsdown";

/**
 * Build for `@zitadel/api-mock`. It is never published; the build exists so it
 * is consumed like every other workspace package (from `dist`, with the
 * `@zitadel/source` condition for in-repo source resolution) and so its moon
 * `build` task has outputs that invalidate dependents.
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
  target: "es2022",
  // The test harnesses import their runners; consumers bring their own copy.
  deps: {
    neverBundle: [/^vitest(\/|$)/, /^@vitest\//, /^msw(\/|$)/, "zod"],
  },
});
