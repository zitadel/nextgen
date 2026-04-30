import {
  defineNuxtModule,
  addPlugin,
  addServerHandler,
  addImportsDir,
  createResolver,
} from "@nuxt/kit";
import type { NextgenModuleOptions } from "./runtime/types";

export default defineNuxtModule<NextgenModuleOptions>({
  meta: {
    name: "@nextgen/sdk-nuxt",
    configKey: "nextgen",
  },
  defaults: {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
    proxyPath: "/__nextgen",
    protectedRoutes: [],
    loginPath: "/login",
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    nuxt.options.runtimeConfig.public.nextgen = {
      issuerUrl: options.issuerUrl ?? "http://localhost:4000",
      loginPath: options.loginPath ?? "/login",
      protectedRoutes: options.protectedRoutes ?? [],
    };

    nuxt.options.runtimeConfig.nextgen = {
      jwtKey: options.jwtKey,
    };

    addPlugin(resolve("./runtime/plugin"));
    addServerHandler({
      middleware: true,
      handler: resolve("./runtime/server/middleware"),
    });
    addImportsDir(resolve("./runtime/composables"));
  },
});
