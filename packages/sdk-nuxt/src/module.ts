import {
  defineNuxtModule,
  addPlugin,
  addServerHandler,
  addImportsDir,
  createResolver,
} from '@nuxt/kit';

import type { NextgenMiddlewareOptions } from './runtime/types';

export default defineNuxtModule<NextgenMiddlewareOptions>({
  meta: {
    name: '@zitadel/sdk-nuxt',
    configKey: 'nextgen',
  },
  defaults: {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL ?? 'http://localhost:4000',
    proxyPath: '/__nextgen',
    protectedRoutes: [],
    loginPath: '/login',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    nuxt.options.runtimeConfig.nextgen = {
      issuerUrl: options.issuerUrl ?? 'http://localhost:4000',
      loginPath: options.loginPath ?? '/login',
      protectedRoutes: options.protectedRoutes ?? [],
      jwtKey: options.jwtKey,
    };

    // Expose SDK-initializer values to the client-side plugin so it can
    // call `configureZitadel()` without hardcoding paths.
    nuxt.options.runtimeConfig.public.nextgenApiBase =
      options.proxyPath ?? '/__nextgen';

    addPlugin(resolve('./runtime/plugin'));
    addServerHandler({
      middleware: true,
      handler: resolve('./runtime/server/handler'),
    });
    addImportsDir(resolve('./runtime/composables'));
  },
});
