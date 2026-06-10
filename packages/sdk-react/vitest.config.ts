import { defineConfig } from 'vitest/config';

/**
 * `dangerouslyIgnoreUnhandledErrors` is enabled for this package only.
 *
 * `@lit/react` binds the `project` property a tick AFTER the custom element
 * upgrades, but `<zitadel-login>` reads its config during its one-shot startup
 * at upgrade time. In a unit test the element therefore starts before any prop
 * is bound and rejects with "requires a config". Passing a `project` prop or
 * calling `configureZitadel()` first does not help: the prop is still bound too
 * late, and the global-config fallback is a different module instance than the
 * one `@zitadel/components` reads under Vitest's resolution.
 *
 * These are light render tests (they only assert the wrapper renders the
 * element), so that single expected mount-time rejection is ignored. Vue and
 * Angular do not need this — Vue binds the prop synchronously and the Angular
 * test does not mount the element.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
