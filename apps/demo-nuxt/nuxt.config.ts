export default defineNuxtConfig({
  ssr: true,
  runtimeConfig: {
    nextgenBackendUrl: process.env.NEXTGEN_BACKEND_URL ?? "http://localhost:4000",
    nextgenSecretKey: process.env.NEXTGEN_SECRET_KEY ?? "dev-secret",
  },
  transpile: ["@nextgen/ui-lit"],
  // Register the proxy server route
  nitro: {
    routeRules: {
      "/__nextgen/**": { proxy: false }, // handled by our server middleware
    },
  },
});
