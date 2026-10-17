import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

/**
 * `resolve.conditions: ['browser']` makes Vitest resolve the *browser* build of
 * `@lit/react`. Default Node resolution picks `@lit/react`'s SSR build, whose
 * `createComponent` only collects props into a server-render bag and never
 * attaches client event listeners — so the `events` map would not fire under
 * test. The browser build attaches real listeners, matching a real app.
 */
export default defineConfig({
  cacheDir: ".vitest",
  resolve: {
    conditions: ["browser"],
  },
  test: {
    ...baseTest,
    name: "@zitadel/sdk-react",
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
});
