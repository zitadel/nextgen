import {
  defineNuxtModule,
  addComponent,
  addPlugin,
  addServerHandler,
  addImportsDir,
  createResolver,
} from '@nuxt/kit';

import type { NextgenMiddlewareOptions } from './runtime/types';

/**
 * Options for the `@zitadel/sdk-nuxt` module (`nuxt.config.ts → nextgen`).
 * Extends the shared middleware options with the public `projectId` the
 * client plugin needs to initialise the SDK.
 */
export interface ZitadelNuxtOptions extends NextgenMiddlewareOptions {
  /**
   * Zitadel project id. Public (not sensitive) — the login widget needs it to
   * start a flow. Usually supplied via `NUXT_PUBLIC_ZITADEL_PROJECT_ID` rather
   * than hardcoded here.
   */
  projectId?: string;
}

export default defineNuxtModule<ZitadelNuxtOptions>({
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
    };

    // Expose SDK-initializer values to the client-side plugin so it can
    // call `configureZitadel()` without hardcoding paths. The project id is
    // required for the plugin to initialise the SDK; defaulting it here (and
    // declaring the key) lets `NUXT_PUBLIC_ZITADEL_PROJECT_ID` override it.
    nuxt.options.runtimeConfig.public.zitadelProxyPath =
      options.proxyPath ?? '/__nextgen';
    nuxt.options.runtimeConfig.public.nextgenProxyPath =
      options.proxyPath ?? '/__nextgen';
    nuxt.options.runtimeConfig.public.zitadelProjectId =
      nuxt.options.runtimeConfig.public.zitadelProjectId ??
      options.projectId ??
      process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ??
      '';

    addPlugin(resolve('./runtime/plugin'));
    addServerHandler({
      middleware: true,
      handler: resolve('./runtime/server/handler'),
    });
    addImportsDir(resolve('./runtime/composables'));

    // Auto-import the Vue wrapper components (`<ZitadelLogin>` /
    // `<ZitadelLogout>`) so consumers can drop them into a page without
    // importing anything or configuring `isCustomElement`.
    addComponent({
      name: 'ZitadelLogin',
      filePath: resolve('./runtime/components/ZitadelLogin'),
    });
    addComponent({
      name: 'ZitadelLogout',
      filePath: resolve('./runtime/components/ZitadelLogout'),
    });
  },
});
