export default defineNuxtConfig({
  compatibilityDate: "2026-04-30",
  ssr: true,
  runtimeConfig: {
    nextgenIssuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
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
