import {
  defineNuxtModule,
  addPlugin,
  addServerHandler,
  addTypeTemplate,
  addImportsDir,
  createResolver,
} from "@nuxt/kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { NuxtModule } from "@nuxt/schema";
import type { NextgenMiddlewareOptions } from "./runtime/types";

const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * Parses `.env.local` in the project root. Quoted values keep their contents
 * verbatim; unquoted values stop at an inline ` #` comment (a bare `#`
 * mid-token is kept, matching dotenv). A key set twice keeps its last value.
 */
function parseEnvLocal(rootDir: string): Record<string, string> {
  const path = resolvePath(rootDir, ".env.local");
  if (!existsSync(path)) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const [, key, rest] = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/) ?? [];
    if (key === undefined || rest === undefined) {
      continue;
    }
    const raw = rest.trim();
    const quoted = raw.match(/^(['"])(.*)\1\s*(?:#.*)?$/);
    values[key] = quoted ? (quoted[2] ?? "") : raw.replace(/\s+#.*$/, "").trim();
  }
  return values;
}

/**
 * The copy overlay the client plugin provides, as `useNuxtApp().$zitadelBusinessLocales`:
 * extra locale strings keyed by primary language subtag.
 */
const BUSINESS_LOCALES_TYPES = `type ZitadelBusinessLocales = Record<string, Partial<Record<string, string>>>;

declare module "#app" {
  interface NuxtApp {
    $zitadelBusinessLocales: ZitadelBusinessLocales;
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $zitadelBusinessLocales: ZitadelBusinessLocales;
  }
}

export {};
`;

/**
 * Returns a lookup for the app's Zitadel settings: the process environment
 * first (it also holds the `.env` Nuxt loaded), then `.env.local`. Nuxt's CLI
 * loads only `.env` unless started with `--dotenv`, but `zitadel setup` writes
 * the settings to `.env.local` (gitignored), which Next.js and Vite load on
 * their own; reading it here gives a Nuxt app the same behavior. Empty values
 * count as unset.
 */
function settingsLookup(rootDir: string): (name: string) => string | undefined {
  const envLocal = parseEnvLocal(rootDir);
  return (name) => process.env[name] || envLocal[name] || undefined;
}

const nextgenModule: NuxtModule<NextgenMiddlewareOptions> =
  defineNuxtModule<NextgenMiddlewareOptions>({
    meta: {
      name: "@zitadel/sdk-nuxt",
      configKey: "nextgen",
    },
    defaults: {
      proxyPath: DEFAULT_PROXY_PATH,
      protectedRoutes: [],
      loginPath: "/login",
    },
    setup(options, nuxt) {
      const { resolve } = createResolver(import.meta.url);
      const setting = settingsLookup(nuxt.options.rootDir);
      const proxyPath = options.proxyPath ?? DEFAULT_PROXY_PATH;

      nuxt.options.runtimeConfig.nextgen = {
        // Only a URL the app set in nuxt.config is kept. The key exists (empty)
        // so `NUXT_NEXTGEN_URL` can set it at runtime; `ZITADEL_URL` is read by
        // the running server and never baked into the build.
        url: options.url || (nuxt.options.dev ? setting("ZITADEL_URL") : undefined) || "",
        // The server middleware proxies this prefix; the plugin hands the same
        // one to the widgets, so the browser calls the path the server serves.
        proxyPath,
        loginPath: options.loginPath ?? "/login",
        protectedRoutes: options.protectedRoutes ?? [],
        // Left unset, these take the middleware's defaults; the handler reads
        // the "" Nitro stores for them as unset.
        ignoredRoutes: options.ignoredRoutes,
        allowedAlgorithms: options.allowedAlgorithms,
        allowedTokenTypes: options.allowedTokenTypes,
        audience: options.audience,
        clockSkewMs: options.clockSkewMs,
        jwksTimeoutMs: options.jwksTimeoutMs,
        proxyTimeoutMs: options.proxyTimeoutMs,
        opaqueTokenTimeoutMs: options.opaqueTokenTimeoutMs,
        jwtKey: options.jwtKey,
        // Server-only. Never filled from the build environment, which would
        // copy it into `.output/`: the running server reads it from
        // `NUXT_NEXTGEN_PROJECT_SECRET` or `ZITADEL_PROJECT_SECRET`. Only
        // `nuxt dev`, which writes no build output, fills it from `.env.local`
        // that the dev server would not otherwise see.
        projectSecret: (nuxt.options.dev ? setting("ZITADEL_PROJECT_SECRET") : undefined) ?? "",
      };

      // Expose SDK-initializer values to the client-side plugin so it can
      // call `configureZitadel()` without hardcoding paths.
      const publicConfig = nuxt.options.runtimeConfig.public;
      publicConfig.zitadelProxyPath = proxyPath;
      publicConfig.nextgenProxyPath = proxyPath;
      // A project id set in `runtimeConfig.public` wins. The key is set even
      // when empty, so `NUXT_PUBLIC_ZITADEL_PROJECT_ID` can still fill it at
      // runtime.
      publicConfig.zitadelProjectId ||= setting("NUXT_PUBLIC_ZITADEL_PROJECT_ID") ?? "";

      addPlugin(resolve("./runtime/plugin"));
      // Loads the widget elements in the browser, so the app does not depend on
      // `@zitadel/components` itself. Client-only: registering custom elements
      // during SSR would break.
      addPlugin({ src: resolve("./runtime/components.client"), mode: "client" });
      // Types the value the plugin above provides. Written into the app's own
      // `.nuxt/types`, with the locale map spelled out, because the app does not
      // install `@zitadel/components`, so a type import from it would not resolve.
      addTypeTemplate({
        filename: "types/zitadel-business-locales.d.ts",
        getContents: () => BUSINESS_LOCALES_TYPES,
      });
      addServerHandler({
        middleware: true,
        handler: resolve("./runtime/server/handler"),
      });
      addImportsDir(resolve("./runtime/composables"));
    },
  });

export default nextgenModule;
