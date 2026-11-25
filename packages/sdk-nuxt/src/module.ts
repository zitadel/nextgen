import {
  defineNuxtModule,
  addPlugin,
  addServerHandler,
  addTypeTemplate,
  addImportsDir,
  createResolver,
  extendViteConfig,
} from "@nuxt/kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { Nuxt, NuxtModule } from "@nuxt/schema";
import type { ZitadelMiddlewareOptions } from "./runtime/types";

const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * Parses the `.env.local` file in the project root into a map of variable names to values.
 *
 * Nuxt's own loader reads only `.env`, so this reader exists to give a Nuxt app the settings that
 * `zitadel setup` writes to `.env.local`. The file is optional: when it does not exist the result
 * is empty. A line may start with `export`. A quoted value keeps its contents verbatim, including
 * any `#`. An unquoted value stops at an inline comment that is introduced by a space and a `#`,
 * while a `#` in the middle of a token stays part of the value, as in dotenv. A key that appears
 * twice keeps its last value. Lines that are not assignments are skipped.
 *
 * @param rootDir - The Nuxt project root that holds the `.env.local` file.
 * @returns The parsed variables, or an empty object when the file does not exist.
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
 * The declaration text written into the app's `.nuxt/types` that types the copy overlay.
 *
 * The client plugin provides the overlay as `useNuxtApp().$zitadelBusinessLocales`, a map of extra
 * locale strings keyed by primary language subtag. The map type is spelled out here instead of
 * imported, because the app does not install `@zitadel/components` itself and a type import from
 * it would not resolve in the app.
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
 * Creates a lookup for the app's Zitadel settings that reads the process environment first and
 * `.env.local` second.
 *
 * The process environment already holds the `.env` file that Nuxt loaded. Nuxt's command line
 * loads only `.env` unless it is started with `--dotenv`, but `zitadel setup` writes the settings
 * to `.env.local`, which is gitignored and which Next.js and Vite load on their own. Reading it
 * here gives a Nuxt app the same behavior. An empty value counts as unset in both places.
 *
 * @param rootDir - The Nuxt project root that holds the `.env.local` file.
 * @returns A function that returns the value of a setting, or `undefined` when neither source
 *   has a non-empty value for it.
 */
function settingsLookup(rootDir: string): (name: string) => string | undefined {
  const envLocal = parseEnvLocal(rootDir);
  return (name) => process.env[name] || envLocal[name] || undefined;
}

/**
 * Lists the settings of the old `nextgen` configuration that an app still carries, so the module
 * can refuse to start instead of ignoring them.
 *
 * The configuration key was renamed from `nextgen` to `zitadel`, together with the
 * `NUXT_NEXTGEN_*` and `NUXT_PUBLIC_NEXTGEN_*` environment variables and the public
 * `nextgenProxyPath` and `nextgenApiBase` runtime settings. Nuxt does not complain about a key no
 * module reads, so an app that kept the old name would lose every setting silently, including
 * `protectedRoutes`, and its protected pages would open to signed-out visitors. Naming the old
 * settings here turns that into a build error.
 *
 * Only the environment of the build or dev server is visible here. A `NUXT_NEXTGEN_*`
 * or `NUXT_PUBLIC_NEXTGEN_*` variable that is set only on the running server cannot be seen at
 * this point.
 *
 * @param nuxt - The Nuxt instance the module is installed into.
 * @returns One line per old setting found, or an empty list when the app uses the new names.
 */
function legacyConfigProblems(nuxt: Nuxt): string[] {
  const options = nuxt.options as unknown as Record<string, unknown>;
  const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>;
  const problems: string[] = [];
  if (options.nextgen !== undefined) {
    problems.push("the `nextgen` key in nuxt.config.ts is now `zitadel`");
  }
  for (const name of ["nextgenProxyPath", "nextgenApiBase"]) {
    if (publicConfig[name] !== undefined) {
      problems.push(
        `runtimeConfig.public.${name} is now runtimeConfig.public.${name.replace("nextgen", "zitadel")}`,
      );
    }
  }
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("NUXT_NEXTGEN_") || name.startsWith("NUXT_PUBLIC_NEXTGEN_")) {
      problems.push(`${name} is now ${name.replace("NEXTGEN_", "ZITADEL_")}`);
    }
  }
  return problems;
}

/**
 * The Nuxt module that wires Zitadel sign-in into an app.
 *
 * Add `"@zitadel/sdk-nuxt/module"` to `modules` in `nuxt.config.ts` and configure it under the
 * `zitadel` key with {@link ZitadelMiddlewareOptions}. No `server/middleware` file is needed,
 * because the module registers the middleware itself. Use {@link server!createZitadelMiddleware} from
 * the server entry instead only when the app must register the middleware by hand.
 *
 * What setup does:
 *
 * - Stores the options in the private `runtimeConfig.zitadel`. Each option can then still be
 *   changed on a running server through a `NUXT_ZITADEL_<NAME>` environment variable, for example
 *   `NUXT_ZITADEL_LOGIN_PATH` or `NUXT_ZITADEL_PROTECTED_ROUTES='["/admin*"]'`. Nitro parses
 *   those values, so a JSON list becomes a list and a number becomes a number.
 * - Never bakes `url` or `projectId` in from the build's environment. The running server reads
 *   `ZITADEL_URL` and `ZITADEL_PROJECT_ID` (or the public `NUXT_PUBLIC_ZITADEL_PROJECT_ID`) when
 *   it runs, so one build works in every environment. A value set under `zitadel` in
 *   `nuxt.config.ts` or in `NUXT_ZITADEL_*` wins over `ZITADEL_*`. Only `nuxt dev` also reads
 *   `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET` and the public project id from `.env.local`, where
 *   `zitadel setup` writes them, because the dev server writes no build output.
 * - Keeps the project secret on the server. The server reads it from
 *   `NUXT_ZITADEL_PROJECT_SECRET` or `ZITADEL_PROJECT_SECRET` when it runs and sends it upstream
 *   only on the session-exchange call. It is never copied into the build output or the client
 *   bundle, because a build that copied it would leak it to anyone who can read `.output/`.
 * - Publishes `proxyPath` and the project id in the public runtime config, so the client plugin
 *   can hand them to the widgets and the browser calls the path the server serves.
 * - Registers a global Nitro server middleware that proxies `proxyPath` (default `/__nextgen`) to
 *   the Zitadel backend on the app's own origin, verifies the session on every other request,
 *   stores the result for {@link server!getAuth} and `useAuth()`, and redirects visitors of
 *   `protectedRoutes` to `loginPath`.
 * - Registers a plugin that seeds `useAuth()` from the server-rendered state and configures the
 *   API client, and a client-only plugin that loads the `<zitadel-login>`, `<zitadel-logout>` and
 *   `<zitadel-session>` elements, so the app does not depend on `@zitadel/components` itself.
 *   Custom elements are registered in the browser only, never during server rendering, where
 *   registering them would fail.
 * - Auto-imports the composables, and writes the type of `$zitadelBusinessLocales` into the app's
 *   own `.nuxt/types`.
 * - In `nuxt dev`, adds the client plugin to Vite's dependency scan, so the widgets' dependencies
 *   are pre-bundled at startup instead of being fetched file by file on first use.
 *
 * A missing `url` falls back to `ZITADEL_URL`, then to `http://localhost:8080`, where
 * `zitadel start` runs the local server.
 *
 * Throws when the app still has the old `nextgen` configuration key, the old `NUXT_NEXTGEN_*`
 * variables or the old public `nextgen*` runtime settings, because they are no longer read and an
 * ignored `protectedRoutes` list would leave pages unprotected.
 *
 * Requires Nuxt 4 or later. The server code uses the h3 1.x helpers that Nuxt's Nitro provides,
 * so the app must not resolve h3 2 for this package.
 *
 * @example
 * ```ts
 * export default defineNuxtConfig({
 *   modules: ["@zitadel/sdk-nuxt/module"],
 *   zitadel: {
 *     protectedRoutes: ["/dashboard*"],
 *     loginPath: "/login",
 *   },
 * });
 * ```
 *
 * @see {@link ZitadelMiddlewareOptions} for every option and its default.
 */
const zitadelModule: NuxtModule<ZitadelMiddlewareOptions> =
  defineNuxtModule<ZitadelMiddlewareOptions>({
    meta: {
      name: "@zitadel/sdk-nuxt",
      configKey: "zitadel",
    },
    defaults: {
      proxyPath: DEFAULT_PROXY_PATH,
      protectedRoutes: [],
      loginPath: "/login",
    },
    async setup(options, nuxt) {
      const legacy = legacyConfigProblems(nuxt);
      if (legacy.length > 0) {
        throw new Error(
          `[zitadel] The Nuxt module was renamed from "nextgen" to "zitadel", and these settings are ` +
            `no longer read, so routes in \`protectedRoutes\` would not be protected: ` +
            `${legacy.join("; ")}.`,
        );
      }
      const { resolve, resolvePath: resolveFile } = createResolver(import.meta.url);
      const setting = settingsLookup(nuxt.options.rootDir);
      const proxyPath = options.proxyPath ?? DEFAULT_PROXY_PATH;

      nuxt.options.runtimeConfig.zitadel = {
        // Only a URL the app set in nuxt.config is kept. The key exists (empty)
        // so `NUXT_ZITADEL_URL` can set it at runtime; `ZITADEL_URL` is read by
        // the running server and never baked into the build.
        url: options.url || (nuxt.options.dev ? setting("ZITADEL_URL") : undefined) || "",
        // The project a session must belong to for its user to count as signed
        // in, when set here or through NUXT_ZITADEL_PROJECT_ID. Unset, the
        // handler takes the public project id the widgets sign users in to,
        // which NUXT_PUBLIC_ZITADEL_PROJECT_ID sets at runtime, then
        // ZITADEL_PROJECT_ID at runtime. Nothing is read from the build's
        // environment here, so a built server is not pinned to it.
        projectId: options.projectId,
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
        // `NUXT_ZITADEL_PROJECT_SECRET` or `ZITADEL_PROJECT_SECRET`. Only
        // `nuxt dev`, which writes no build output, fills it from `.env.local`
        // that the dev server would not otherwise see.
        projectSecret: (nuxt.options.dev ? setting("ZITADEL_PROJECT_SECRET") : undefined) ?? "",
      };

      // Expose SDK-initializer values to the client-side plugin so it can
      // call `configureZitadel()` without hardcoding paths.
      const publicConfig = nuxt.options.runtimeConfig.public;
      publicConfig.zitadelProxyPath = proxyPath;
      // A project id set in `runtimeConfig.public` wins. The key is set even
      // when empty, so `NUXT_PUBLIC_ZITADEL_PROJECT_ID` can still fill it at
      // runtime.
      publicConfig.zitadelProjectId ||= setting("NUXT_PUBLIC_ZITADEL_PROJECT_ID") ?? "";

      addPlugin(resolve("./runtime/plugin"));
      // Loads the widget elements in the browser, so the app does not depend on
      // `@zitadel/components` itself. Client-only: registering custom elements
      // during SSR would break.
      addPlugin({ src: resolve("./runtime/components.client"), mode: "client" });
      if (nuxt.options.dev) {
        // `nuxt dev` pre-bundles the dependencies its startup scan finds from
        // Nuxt's entry, but the scan stops at the virtual module that lists the
        // plugins and never reaches the widgets' (lit, lucide and the rest).
        // Vite then bundles those once a page asks for them, and never when
        // this package is installed in node_modules: the browser fetches them
        // file by file. Scanning the plugin too bundles them at startup. Vite
        // drops an entry that names no file, so the path carries its extension.
        const componentsPlugin = await resolveFile("./runtime/components.client");
        extendViteConfig((config) => {
          config.optimizeDeps ??= {};
          const { entries = [] } = config.optimizeDeps;
          config.optimizeDeps.entries = [entries, componentsPlugin].flat();
        });
      }
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

export default zitadelModule;
