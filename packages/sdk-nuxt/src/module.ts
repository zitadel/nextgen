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
    name: '@nextgen/sdk-nuxt',
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

    addPlugin(resolve('./runtime/plugin'));
    addServerHandler({
      middleware: true,
      handler: resolve('./runtime/server/handler'),
    });
    addImportsDir(resolve('./runtime/composables'));
  },
});
