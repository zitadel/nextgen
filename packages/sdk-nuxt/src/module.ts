import {
  defineNuxtModule,
  addComponent,
  addPlugin,
  addServerHandler,
  addImportsDir,
  createResolver,
} from "@nuxt/kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { NextgenMiddlewareOptions } from "./runtime/types";

/**
 * Resolve `ZITADEL_PROJECT_SECRET`. Nuxt's CLI auto-loads `.env` but the
 * project's CLI scaffolds write the secret to `.env.local` (gitignored), which
 * `nuxi` does not auto-load on every release path. Fall back to a one-shot
 * parse so the secret reaches `runtimeConfig` regardless of which env file
 * Nuxt picked up.
 */
function loadProjectSecret(rootDir: string): string | undefined {
  if (process.env.ZITADEL_PROJECT_SECRET) {
    return process.env.ZITADEL_PROJECT_SECRET;
  }
  const path = resolvePath(rootDir, ".env.local");
  if (!existsSync(path)) {
    return undefined;
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?ZITADEL_PROJECT_SECRET\s*=\s*(.*)$/);
    if (match && match[1] !== undefined) {
      const raw = match[1].trim();
      const quoted = raw.match(/^(['"])(.*)\1\s*(?:#.*)?$/);
      // Quoted values keep their contents verbatim; unquoted values stop at an
      // inline ` #` comment (a bare `#` mid-token is kept, matching dotenv).
      const value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "").trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

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
    name: "@zitadel/sdk-nuxt",
    configKey: "nextgen",
  },
  defaults: {
    url: process.env.ZITADEL_URL ?? "http://localhost:8080",
    proxyPath: "/__nextgen",
    protectedRoutes: [],
    loginPath: "/login",
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    nuxt.options.runtimeConfig.nextgen = {
      url: options.url ?? "http://localhost:4000",
      loginPath: options.loginPath ?? "/login",
      protectedRoutes: options.protectedRoutes ?? [],
      jwtKey: options.jwtKey,
      // Server-only — never exposed to the client. Override at deploy time via
      // `NUXT_NEXTGEN_PROJECT_SECRET`. Left undefined when the env var (and
      // `.env.local`) provide no value, so the middleware surfaces a missing
      // bearer instead of silently sending an empty one.
      projectSecret: loadProjectSecret(nuxt.options.rootDir),
    };

    // Expose SDK-initializer values to the client-side plugin so it can
    // call `configureZitadel()` without hardcoding paths. The project id is
    // required for the plugin to initialise the SDK; defaulting it here (and
    // declaring the key) lets `NUXT_PUBLIC_ZITADEL_PROJECT_ID` override it.
    nuxt.options.runtimeConfig.public.zitadelProxyPath = options.proxyPath ?? "/__nextgen";
    nuxt.options.runtimeConfig.public.nextgenProxyPath = options.proxyPath ?? "/__nextgen";
    nuxt.options.runtimeConfig.public.zitadelProjectId =
      nuxt.options.runtimeConfig.public.zitadelProjectId ??
      options.projectId ??
      process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ??
      "";

    addPlugin(resolve("./runtime/plugin"));
    addServerHandler({
      middleware: true,
      handler: resolve("./runtime/server/handler"),
    });
    addImportsDir(resolve("./runtime/composables"));

    // Auto-import the Vue wrapper components (`<ZitadelLogin>` /
    // `<ZitadelLogout>`) so consumers can drop them into a page without
    // importing anything or configuring `isCustomElement`.
    addComponent({
      name: "ZitadelLogin",
      filePath: resolve("./runtime/components/ZitadelLogin"),
    });
    addComponent({
      name: "ZitadelLogout",
      filePath: resolve("./runtime/components/ZitadelLogout"),
    });
  },
});
