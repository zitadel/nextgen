import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type Alias, defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";

import { baseTest } from "@zitadel/vitest-config";

const defaultConsoleBase = "/ui/console/";
const consoleOutDir = "../../internal/staticui/console/dist";
const defaultApiBase = "/api";
const defaultBackendUrl = "http://localhost:8080";

export default defineConfig(async ({ command, mode, isPreview }) => {
  const addon = await consoleAddon(mode);
  return {
    root: import.meta.dirname,
    // The build emits absolute `/ui/console/` asset URLs (the console embeds in
    // the Go server under that path; the hosted cloud builds for another, see
    // consoleBase). `vite preview` runs with command "serve", so it must opt
    // into the same base or the built index.html's asset links 404 and the SPA
    // never mounts. The dev server (plain "serve") stays at "/".
    base: command === "build" || isPreview ? consoleBase(mode) : "/",
    define: {
      // The Zitadel server the dev loop proxies to, which the page cannot see
      // from its own origin (`src/lib/server-origin.ts`). Empty in a build, where
      // the console is served with the API, and in tests, which have no server.
      "import.meta.env.CONSOLE_SERVER_ORIGIN": JSON.stringify(
        command === "serve" && !isPreview && mode !== "test"
          ? new URL(devBackendUrl(mode)).origin
          : "",
      ),
    },
    server: {
      port: 5174,
      strictPort: true,
      // Dev-server-only API proxy (Console ADR 0002), the frontend HMR loop. The
      // browser calls the same-origin `/api` base and this Node-side proxy
      // forwards it to the Go server, stripping the prefix. It adds no
      // credential: the console user signs in through the embedded login widget
      // (Console ADR 0003), and the session cookie that rides along
      // on these same-origin requests authorizes every management call, exactly
      // as it does in the embedded build (#1300). `vite preview` is deliberately
      // left un-proxied so it can't be mistaken for the production path.
      proxy: command === "serve" && !isPreview ? devApiProxy(mode) : undefined,
      watch: {
        // Playground chrome lives outside `apps/console`; ensure CSS edits propagate.
        ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**"],
      },
    },
    cacheDir: ".vitest",
    // Resolve workspace `@zitadel/*` packages straight from `.ts`
    // source for hot dev iteration. Production builds pick up pre-built
    // `dist/*.mjs` via the default `import` condition instead.
    // `@/*` → `src/*` is the shadcn/ui convention used across the console;
    // consoleAddon adds the build's add-on.
    resolve: {
      conditions: ["@zitadel/source"],
      alias: addon.alias,
      dedupe: addon.dedupe,
    },
    plugins: [
      // Ahead of Tailwind, which reads the stylesheet one of them extends.
      ...addon.plugins,
      tailwindcss(),
      devtools(),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        // Co-located *.spec.tsx files under routes/ are tests, not routes.
        routeFileIgnorePattern: "\\.spec\\.(ts|tsx)$",
      }),
      react(),
      keepGoEmbedPlaceholder(consoleOutDir),
    ],
    build: {
      outDir: consoleOutDir,
      emptyOutDir: true,
      reportCompressedSize: true,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
    test: {
      ...baseTest,
      name: "@zitadel/console",
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      // The env every spec starts from. Vite also loads `.env.local`, so without
      // the blank fallback a developer's local VITE_CONSOLE_RUNTIME_FALLBACK would
      // turn runtime-discovery failures into the standalone fallback (Console ADR
      // 0004 §3). A spec that needs another value stubs it with `vi.stubEnv`, and
      // `unstubEnvs` restores these before the next test.
      env: {
        VITE_CONSOLE_API_BASE: "http://localhost/api",
        VITE_CONSOLE_RUNTIME_FALLBACK: "",
      },
      unstubEnvs: true,
      // Above the RTL asyncUtilTimeout (5s, set in test-setup.ts) with room for a
      // test that makes several queries, so a slow query reports its own Testing
      // Library diagnostic rather than being cut short by this budget. A file's
      // first test also imports the router and every screen (test-setup.ts): in
      // CI that first test takes ~9s, and up to ~16s on a busy runner.
      testTimeout: 30_000,
    },
  };
});

/**
 * The Go server the dev proxy forwards to. Node-only var — deliberately NOT
 * VITE_ prefixed, so it is never inlined into the client bundle as-is; only
 * its origin is, as CONSOLE_SERVER_ORIGIN. Loading with an empty prefix stays
 * config-time and server-side only, so `.env.local` works without exporting it
 * in the shell; the process environment still wins. `console:dev-real`
 * threads it from the boot-captured @zitadel/testing instance handle
 * (`scripts/dev-real.mts`).
 */
function devBackendUrl(mode: string): string {
  const nodeEnv = loadEnv(mode, import.meta.dirname, "");
  return process.env.CONSOLE_BACKEND_URL || nodeEnv.CONSOLE_BACKEND_URL || defaultBackendUrl;
}

function devApiProxy(mode: string): Record<string, ProxyOptions> {
  // Public, browser-safe var (VITE_ prefixed): the API base the SDK client
  // targets. `/api` is this proxy's own path and applies to the dev server
  // only — the built console targets the origin root, where the Go binary
  // serves the API (`src/api/zitadel.ts`, Console ADR 0002 §4).
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  const apiBase = env.VITE_CONSOLE_API_BASE || defaultApiBase;
  // Removed in #1345: the console takes the project it signs into from the
  // server's `/console/runtime.json`. Said out loud, because a `.env.local`
  // that still sets it would otherwise be ignored without a word.
  if (env.VITE_CONSOLE_PROJECT_ID) {
    console.warn(
      "[console] VITE_CONSOLE_PROJECT_ID is no longer read and has no effect: the console " +
        "takes its sign-in project from /console/runtime.json. Remove it from your env.",
    );
  }
  const backendUrl = devBackendUrl(mode);

  // Anchor the context to a path segment so a similarly-prefixed path (e.g.
  // `/api2/...`) is not accidentally proxied and rewritten.
  const escaped = apiBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return {
    // Console ADR 0004 §3: the pre-session runtime-metadata document lives
    // at a root path served by the Go mux; forward it as-is (public, no
    // bearer to inject).
    "/console/runtime.json": {
      target: backendUrl,
      changeOrigin: true,
    },
    [`^${escaped}(/|$)`]: {
      target: backendUrl,
      changeOrigin: true,
      rewrite: (path: string) => {
        const stripped = path.startsWith(apiBase) ? path.slice(apiBase.length) : path;
        return stripped.startsWith("/") ? stripped : `/${stripped}`;
      },
      // `CONSOLE_DEV_PROXY_LOG=1` prints each proxied request — the thing to
      // look at when a screen answers 401/403/404 and it is not obvious what
      // the server was asked.
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          if (process.env.CONSOLE_DEV_PROXY_LOG) {
            console.log(`[console-proxy] ${proxyReq.method} ${proxyReq.path}`);
          }
        });
      },
    },
  };
}

// The path the build is served under: the Go server's `/ui/console/`, unless
// CONSOLE_BASE_PATH names another. The hosted cloud's console service sets
// `/console/` (repo-root vercel.json) and points the server's console links
// there (apps/cloud/launcher). Unprefixed for the same reason as CONSOLE_ADDON
// below. Anything but an absolute path fails the build.
function consoleBase(mode: string): string {
  const name = "CONSOLE_BASE_PATH";
  const value = loadEnv(mode, import.meta.dirname, "")[name] || defaultConsoleBase;
  if (!/^(\/[\w.-]+)+\/?$/.test(value)) {
    throw new Error(`${name} must be an absolute path such as /console/, got "${value}".`);
  }
  return value.endsWith("/") ? value : `${value}/`;
}

// The add-on the build compiles in place of the empty one (src/addon/index.ts,
// Console ADR 0006): the package in the folder CONSOLE_ADDON names, relative
// to this one, whose entry Vite takes from its package.json. The hosted
// cloud's console service names ../cloud-console (repo-root vercel.json);
// unset, as for the console the Go server embeds, the build keeps the empty
// one. The add-on resolves React from its own folder; deduped, it always gets
// the console's copy, because with a second one its hooks would fail. Not
// VITE_-prefixed: turbo hashes every VITE_* variable into every Vite package
// built in the same run, so the console's dependencies would get other cache
// keys in the cloud's console build than in all their other builds.
//
// An add-on's own settings come from its folder's `vite.ts`, if it has one:
// its default export is a plugin, which Node loads as it is.
async function consoleAddon(
  mode: string,
): Promise<{ alias: Alias[]; dedupe: string[]; plugins: Plugin[] }> {
  const alias: Alias[] = [{ find: "@", replacement: resolve(import.meta.dirname, "src") }];
  const name = "CONSOLE_ADDON";
  const value = loadEnv(mode, import.meta.dirname, "")[name];
  if (!value) {
    return { alias, dedupe: [], plugins: [] };
  }
  const folder = resolve(import.meta.dirname, value);
  if (!existsSync(resolve(folder, "package.json"))) {
    throw new Error(
      `${name} must name a package's folder, such as ../cloud-console, got "${value}".`,
    );
  }
  const plugins = [addonEntry(folder), addonStylesheet(folder)];
  const own = resolve(folder, "vite.ts");
  if (existsSync(own)) {
    const { default: plugin } = (await import(pathToFileURL(own).href)) as {
      default: () => Plugin;
    };
    plugins.push(plugin());
  }
  return { alias, dedupe: ["react", "react-dom"], plugins };
}

// Whatever names the empty add-on (`@/addon`, `./addon`, `../addon/index`)
// gets the build's: the check is on the file an import resolves to, not on
// how it is spelled.
function addonEntry(folder: string): Plugin {
  const empty = resolve(import.meta.dirname, "src/addon/index.ts");
  return {
    name: "zitadel-console-addon-entry",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved?.id !== empty) return resolved;
      return this.resolve(folder, importer, { ...options, skipSelf: true });
    },
  };
}

// Tailwind emits the utilities it finds in the console's folder; an add-on's
// screens sit outside it, so the build that compiles one in names its `src`
// in the stylesheet as well.
function addonStylesheet(folder: string): Plugin {
  const stylesheet = resolve(import.meta.dirname, "src/styles.css");
  const source = relative(dirname(stylesheet), resolve(folder, "src"));
  return {
    name: "zitadel-console-addon-stylesheet",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== stylesheet) return;
      return `${code}\n@source "${source}";\n`;
    },
  };
}

function keepGoEmbedPlaceholder(outDir: string) {
  const writePlaceholder = () => {
    const dir = resolve(import.meta.dirname, outDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, ".gitkeep"), "");
  };

  return {
    name: "zitadel-go-embed-placeholder",
    buildEnd(error?: Error) {
      if (error) {
        writePlaceholder();
      }
    },
    closeBundle() {
      writePlaceholder();
    },
  };
}
