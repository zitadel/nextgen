export default defineNuxtConfig({
  modules: ["@zitadel-nextgen/sdk-nuxt/module"],
  nextgen: {
    protectedRoutes: ["/admin", "/admin/*"],
    loginPath: "/login",
  },
  compatibilityDate: "2026-04-30",
  css: ["~/assets/css/demo-host.css"],
  ssr: true,
  build: {
    transpile: [
      "@zitadel-nextgen/components",
      "@zitadel-nextgen/shared-component-styles",
      "@zitadel-nextgen/design-tokens",
    ],
  },
  runtimeConfig: {
    nextgenIssuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
    public: {
      nextgenApiBase: "/__nextgen",
      zitadelProjectId: process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ?? "demo",
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
