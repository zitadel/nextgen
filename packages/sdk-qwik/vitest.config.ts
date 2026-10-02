import { qwikVite } from "@qwik.dev/core/optimizer";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

// Runs in real Chromium via Playwright (mirroring the `@zitadel/components`
// browser lane) rather than jsdom. Qwik 2's client `render` locates its root
// through a `[q:container]` attribute selector that jsdom's selector engine
// cannot match, and the widgets wrap real Lit custom elements that only upgrade
// in a real DOM — so a browser is the only environment where `render`, element
// upgrade, and native custom events all behave as they do in production.
export default defineConfig({
  cacheDir: ".vitest",
  plugins: [qwikVite()],
  resolve: {
    // Use the browser build so Qwik's client `render()` resolves correctly.
    conditions: ["browser"],
  },
  test: {
    ...baseTest,
    name: "@zitadel/sdk-qwik",
    setupFiles: ["src/test-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
