// A deliberately minimal pre-existing config: setup must merge its module
// registration and runtime config into it without discarding what is here.
export default defineNuxtConfig({
  compatibilityDate: "2026-08-01",
  // Nuxt DevTools injects @vue/devtools-core/-kit into the dev client, which
  // Vite only discovers on the first browser load: it then re-optimizes and
  // full-reloads the page ~2-3s in, aborting whatever navigation is in flight
  // (ERR_ABORTED on /login, issue #1479). The journey never uses DevTools, so
  // keep it out of the dev server rather than racing its optimizer.
  devtools: { enabled: false },
});
