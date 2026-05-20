/**
 * Register Lit custom elements on the client only. Do not import
 * `@zitadel-nextgen/components` from page `<script setup>` — that runs during SSR
 * and breaks shadow-root font injection after hydration.
 */
import "@zitadel-nextgen/components";

export default defineNuxtPlugin(() => {});
