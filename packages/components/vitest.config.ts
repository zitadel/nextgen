import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * Vite plugin: import `.liquid` files as default-exported strings.
 *
 * Uses `resolveId` to tag `.liquid` imports with a `\0liquid:` prefix, then
 * `load` intercepts the tagged ID and returns the file contents as a JS
 * default export. This prevents Vite's built-in loaders from treating the
 * Liquid syntax as invalid JS.
 */
function liquidRaw(): Plugin {
  return {
    name: "liquid-raw",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.endsWith(".liquid") && importer) {
        const dir = importer.replace(/\/[^/]*$/, "");
        const resolved = resolve(dir, source);
        return `\0liquid:${resolved}`;
      }
      return null;
    },
    load(id) {
      if (!id.startsWith("\0liquid:")) return null;
      const filePath = id.slice("\0liquid:".length);
      const content = readFileSync(filePath, "utf-8");
      return `export default ${JSON.stringify(content)};`;
    },
  };
}

/** Shared plugins for all vitest projects. */
const sharedPlugins = () => [nxViteTsPaths(), liquidRaw()];

/**
 * Two test projects:
 *
 * - `unit` — runs in jsdom. Fast feedback for the bulk of the suite. Skips
 *   the form-associated custom-element checks because jsdom 29 only ships a
 *   partial implementation.
 * - `browser` — runs in real Chromium via Playwright. Owns the
 *   `*.browser.spec.ts` files: form participation, Enter-to-submit, focus
 *   management, and other behaviours that require a real platform.
 *
 * `pnpm test` runs the unit project (the default in CI / pre-commit).
 * `pnpm test:browser` runs the browser project. `pnpm test:all` runs both.
 */
export default defineConfig({
  plugins: sharedPlugins(),
  resolve: { conditions: ["@zitadel-nextgen/source"] },
  test: {
    name: "@zitadel-nextgen/components",
    watch: false,
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        plugins: sharedPlugins(),
        resolve: { conditions: ["@zitadel-nextgen/source"] },
        test: {
          name: "unit",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        plugins: sharedPlugins(),
        resolve: { conditions: ["@zitadel-nextgen/source"] },
        test: {
          name: "browser",
          globals: true,
          include: ["src/**/*.browser.spec.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
