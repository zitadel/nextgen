export default defineNuxtConfig({
  // Write build artefacts to /tmp so the dev server never writes inside the
  // project tree. This avoids EACCES errors when a previous `sudo nuxt dev`
  // run left root-owned files in .nuxt/dev/. Override with NUXT_BUILD_DIR if
  // you need per-machine isolation (e.g. parallel CI jobs).
  buildDir: process.env.NUXT_BUILD_DIR ?? "/tmp/demo-nuxt-build",
  compatibilityDate: "2026-04-30",
  ssr: true,
  runtimeConfig: {
    nextgenIssuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
  },
  vite: {
    // Keep Vite's dep-optimisation cache out of the project tree for the same
    // reason as buildDir above.
    cacheDir: process.env.NUXT_VITE_CACHE_DIR ?? "/tmp/demo-nuxt-vite-cache",
    optimizeDeps: {
      include: ["lit"],
    },
  },
  nitro: {
    routeRules: {
      "/__nextgen/**": {},
    },
  },
});
