// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@zitadel/sdk-nuxt/module'],

  nextgen: {
    loginPath: '/login',
    protectedRoutes: ['/profile']
  },

  vue: {
    compilerOptions: {
      isCustomElement: tag => tag.startsWith("zitadel-")
    }
  }
})
