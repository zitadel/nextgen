export default defineNuxtConfig({
  buildDir: process.env.NEXTGEN_NUXT_BUILD_DIR ?? ".nuxt",
  modules: ["@zitadel/sdk-nuxt/module"],
  typescript: {
    tsConfig: {
      // Generated into the build dir (`.nuxt/`), hence three levels up. Nuxt's
      // own compilerOptions are written into the generated file and win over
      // the base; the base adds the repo's strictness and `@zitadel/source`.
      extends: "../../../tsconfig.base.json",
    },
  },
  nextgen: {
    protectedRoutes: ["/admin", "/admin/*"],
    loginPath: "/login",
  },
  compatibilityDate: "2026-04-30",
  css: ["~/assets/css/demo-host.css"],
  ssr: true,
  vue: {
    compilerOptions: {
      // The `zitadel-*` widgets are Lit custom elements, not Vue components.
      isCustomElement: (tag) => tag.startsWith("zitadel-"),
    },
  },
  runtimeConfig: {
    public: {
      nextgenProxyPath: "/__nextgen",
      zitadelProjectId: process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ?? "proj_demo",
    },
  },
  vite: {
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
