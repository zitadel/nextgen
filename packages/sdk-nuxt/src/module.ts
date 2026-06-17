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
    url: process.env.ZITADEL_URL ?? 'http://localhost:8080',
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
      // Read at build/dev start where Nuxt's env-loading has already populated
      // `process.env` (including from `.env.local`). Lands in server-only
      // runtimeConfig — never exposed to the client. Override at deploy time
      // via `NUXT_NEXTGEN_PROJECT_SECRET`.
      projectSecret: process.env.ZITADEL_PROJECT_SECRET ?? '',
    };

    // Expose SDK-initializer values to the client-side plugin so it can
    // call `configureZitadel()` without hardcoding paths.
    nuxt.options.runtimeConfig.public.zitadelProxyPath =
      options.proxyPath ?? '/__nextgen';
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
