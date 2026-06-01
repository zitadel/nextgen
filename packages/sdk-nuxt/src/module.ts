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
    name: '@zitadel-nextgen/sdk-nuxt',
    configKey: 'nextgen',
  },
  defaults: {
    url:
      process.env.ZITADEL_URL ??
      'http://localhost:4000',
    proxyPath: '/__nextgen',
    protectedRoutes: [],
    loginPath: '/login',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    nuxt.options.runtimeConfig.nextgen = {
      url: options.url ?? 'http://localhost:4000',
      loginPath: options.loginPath ?? '/login',
      protectedRoutes: options.protectedRoutes ?? [],
      jwtKey: options.jwtKey,
    };

    // Expose SDK-initializer values to the client-side plugin so it can
    // call `configureZitadel()` without hardcoding paths.
    nuxt.options.runtimeConfig.public.nextgenProxyPath =
      options.proxyPath ?? '/__nextgen';

    addPlugin(resolve('./runtime/plugin'));
    addServerHandler({
      middleware: true,
      handler: resolve('./runtime/server/handler'),
    });
    addImportsDir(resolve('./runtime/composables'));
  },
});
