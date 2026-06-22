/**
 * Register Lit custom elements on the client only. Do not import
 * `@zitadel/components` from page `<script setup>` — that runs during SSR
 * and breaks shadow-root font injection after hydration.
 */
import "@zitadel/components";

export default defineNuxtPlugin(() => {
  return;
});
