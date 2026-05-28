export default defineNuxtConfig({
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
