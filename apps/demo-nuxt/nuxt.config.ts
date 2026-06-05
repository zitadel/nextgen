export default defineNuxtConfig({
  buildDir: process.env.NEXTGEN_NUXT_BUILD_DIR ?? ".nuxt",
  modules: ["@zitadel/sdk-nuxt/module"],
  nextgen: {
    protectedRoutes: ["/admin", "/admin/*"],
    loginPath: "/login",
  },
  compatibilityDate: "2026-04-30",
  css: ["~/assets/css/demo-host.css"],
  ssr: true,
  build: {
    transpile: [
      "@zitadel/api",
      "@zitadel/components",
      "@zitadel/shared-component-styles",
      "@zitadel/design-tokens",
    ],
  },
  runtimeConfig: {
    zitadelUrl: process.env.ZITADEL_URL ?? "http://localhost:8080",
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
