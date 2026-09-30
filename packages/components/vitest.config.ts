import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { liquidRaw } from "./vite-liquid-plugin.js";

/**
 * Unit lane (jsdom) — the default `vitest run`. Fast feedback for the bulk of
 * the suite; skips the form-associated custom-element checks because jsdom 29
 * only ships a partial implementation.
 *
 * The browser lane lives in `vitest.browser.config.ts` (run via `test:browser`)
 * so it stays out of the default run: it needs a real Chromium and writes its
 * own junit file, both of which belong in that config rather than a CLI flag.
 */
export default defineConfig({
  plugins: [liquidRaw()],
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/components",
    environment: "jsdom",
    include: ["src/**/*.spec.ts"],
    exclude: ["src/**/*.browser.spec.ts"],
  },
});
