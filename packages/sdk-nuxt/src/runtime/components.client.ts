import { defineNuxtPlugin } from "#imports";
// Importing the package registers the widget custom elements (<zitadel-login>
// and the rest). This plugin is client-only, so it never runs during SSR.
import { businessLocales } from "@zitadel/components";

/**
 * The client-only Nuxt plugin that loads the widget elements and provides the copy overlay.
 *
 * Importing `@zitadel/components` registers `<zitadel-login>`, `<zitadel-logout>` and
 * `<zitadel-session>` as custom elements, so an app does not depend on that package itself. It runs
 * in the browser only, because registering custom elements during server rendering would fail: the
 * server renders the unupgraded tags and the browser upgrades them after hydration. The plugin
 * provides the overlay as `$zitadelBusinessLocales`.
 *
 * The module registers this plugin. An app does not import it.
 */
export default defineNuxtPlugin(() => ({
  provide: { zitadelBusinessLocales: businessLocales },
}));
