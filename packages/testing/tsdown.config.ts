import { defineConfig } from "tsdown";

const entry = {
  index: "src/index.ts",
  playwright: "src/playwright.ts",
  // Executables behind the webServer entries that withZitadel() generates;
  // resolved as dist siblings of the playwright entry, not via exports.
  supervisor: "src/supervisor.ts",
  "app-runner": "src/app-runner.ts",
};

export default defineConfig([
  {
    entry,
    outDir: "dist",
    format: ["esm"],
    tsconfig: "tsconfig.lib.json",
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    deps: {
      neverBundle: ["@zitadel/api", "@zitadel/cli", "@zitadel/config", "@playwright/test"],
    },
  },
  {
    // CJS build for Playwright's require() path. Its Babel hook transpiles
    // workspace-realpath ESM to CJS while Node still evaluates the .mjs as an
    // ES module, so the require chain must stay CJS end-to-end — which also
    // means bundling the ESM-only workspace deps instead of externalizing.
    entry,
    outDir: "dist",
    format: ["cjs"],
    tsconfig: "tsconfig.lib.json",
    dts: false,
    sourcemap: true,
    clean: false,
    target: "es2022",
    deps: {
      neverBundle: ["@zitadel/cli", "@playwright/test"],
      alwaysBundle: [/^@zitadel\/(api|config)(\/|$)/],
    },
  },
]);
