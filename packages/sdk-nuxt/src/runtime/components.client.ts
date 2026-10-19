import { defineNuxtPlugin } from "#imports";
// Importing the package registers the widget custom elements (<zitadel-login>
// and the rest). This plugin is client-only, so it never runs during SSR.
import { businessLocales } from "@zitadel/components";

export default defineNuxtPlugin(() => ({
  provide: { zitadelBusinessLocales: businessLocales },
}));
