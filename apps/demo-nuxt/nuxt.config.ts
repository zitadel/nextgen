export default defineNuxtConfig({
  ssr: true,
  runtimeConfig: {
    nextgenIssuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
  },
  transpile: ["@nextgen/ui-lit"],
  nitro: {
    routeRules: {
      "/__nextgen/**": { proxy: false },
    },
  },
});
