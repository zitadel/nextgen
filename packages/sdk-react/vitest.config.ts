import { defineConfig } from "vitest/config";

/**
 * `resolve.conditions: ['browser']` makes Vitest resolve the *browser* build of
 * `@lit/react`. Default Node resolution picks `@lit/react`'s SSR build, whose
 * `createComponent` only collects props into a server-render bag and never
 * attaches client event listeners — so the `events` map would not fire under
 * test. The browser build attaches real listeners, matching a real app.
 *
 * `dangerouslyIgnoreUnhandledErrors` is enabled because `@lit/react` binds the
 * `project` property a tick AFTER the custom element upgrades, but
 * `<zitadel-login>` reads its config during its one-shot startup at upgrade
 * time. In a unit test the element therefore starts before the prop is bound
 * and rejects with "requires a config". These are light render/event tests, so
 * that single expected mount-time rejection is ignored.
 */
export default defineConfig({
  resolve: {
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
