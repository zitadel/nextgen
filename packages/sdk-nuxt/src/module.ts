import {
  defineNuxtModule,
  addPlugin,
  addServerHandler,
  addImportsDir,
  createResolver,
} from "@nuxt/kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { NuxtModule } from "@nuxt/schema";
import type { NextgenMiddlewareOptions } from "./runtime/types";

/** Where `zitadel start` runs the local server by default. */
const DEFAULT_URL = "http://localhost:8080";
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
        // A `nextgen.url` in nuxt.config wins over `ZITADEL_URL`.
        url: options.url || setting("ZITADEL_URL") || DEFAULT_URL,
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
        // Server-only — never exposed to the client. Override at deploy time via
        // `NUXT_NEXTGEN_PROJECT_SECRET`. Left undefined when the env var (and
        // `.env.local`) provide no value, so the middleware surfaces a missing
        // exchange bearer instead of silently sending an empty one.
        projectSecret: setting("ZITADEL_PROJECT_SECRET"),
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

      // The `<zitadel-*>` tags are Lit custom elements, not Vue components:
      // without this, Vue tries to resolve them and warns "Failed to resolve
      // component" for every widget in a template. An app's own predicate is
      // kept and still consulted.
      nuxt.options.vue ??= {} as typeof nuxt.options.vue;
      nuxt.options.vue.compilerOptions ??= {};
      const compilerOptions = nuxt.options.vue.compilerOptions;
      const appPredicate = compilerOptions.isCustomElement;
      compilerOptions.isCustomElement = (tag: string) =>
        tag.startsWith("zitadel-") || appPredicate?.(tag) === true;

      addPlugin(resolve("./runtime/plugin"));
      addServerHandler({
        middleware: true,
        handler: resolve("./runtime/server/handler"),
      });
      addImportsDir(resolve("./runtime/composables"));
    },
  });

export default nextgenModule;
