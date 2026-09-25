import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

const consoleBase = "/ui/console/";
const consoleOutDir = "../../internal/staticui/console/dist";
const defaultApiBase = "/api";
const defaultBackendUrl = "http://localhost:8080";

export default defineConfig(({ command, mode, isPreview }) => ({
  root: import.meta.dirname,
  // The build emits absolute `/ui/console/` asset URLs (the console embeds in
  // the Go server under that path). `vite preview` runs with command "serve",
  // so it must opt into the same base or the built index.html's asset links
  // 404 and the SPA never mounts. The dev server (plain "serve") stays at "/".
  base: command === "build" || isPreview ? consoleBase : "/",
  server: {
    port: 5174,
    strictPort: true,
    // Dev-server-only API proxy (Console ADR 0002), the frontend HMR loop. The
    // browser calls the same-origin `/api` base and this Node-side proxy
    // forwards it to the Go server, stripping the prefix. It adds no
    // credential: the console user signs in through the embedded login widget
    // (Console ADR 0003), and the `__nextgen_session` cookie that rides along
    // on these same-origin requests authorizes every management call, exactly
    // as it does in the embedded build (#1300). `vite preview` is deliberately
    // left un-proxied so it can't be mistaken for the production path.
    proxy: command === "serve" && !isPreview ? devApiProxy(mode) : undefined,
    watch: {
      // Playground chrome lives outside `apps/console`; ensure CSS edits propagate.
      ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**"],
    },
  },
  cacheDir: "../../node_modules/.vite/apps/console",
  // Resolve workspace `@zitadel/*` packages straight from `.ts`
  // source for hot dev iteration. Production builds pick up pre-built
  // `dist/*.mjs` via the default `import` condition instead.
  // `@/*` → `src/*` is the shadcn/ui convention used across the console.
  resolve: {
    conditions: ["@zitadel/source"],
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  plugins: [
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
    name: "@zitadel/console",
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.spec.{ts,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8" as const,
      include: ["src/**/*.{ts,tsx}"],
    },
  },
}));

function devApiProxy(mode: string): Record<string, ProxyOptions> {
  // Public, browser-safe var (VITE_ prefixed): the API base the SDK client
  // targets. `/api` is this proxy's own path and applies to the dev server
  // only — the built console targets the origin root, where the Go binary
  // serves the API (`src/api/zitadel.ts`, Console ADR 0002 §4).
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  const apiBase = env.VITE_CONSOLE_API_BASE || defaultApiBase;
  // Node-only var — deliberately NOT VITE_ prefixed, so it is never inlined
  // into the client bundle. Loading with an empty prefix stays config-time and
  // server-side only, so `.env.local` works without exporting it in the shell;
  // the process environment still wins. `console:dev-real` threads it from the
  // boot-captured @zitadel/testing instance handle (`scripts/dev-real.mts`).
  const nodeEnv = loadEnv(mode, import.meta.dirname, "");
  const backendUrl =
    process.env.CONSOLE_BACKEND_URL || nodeEnv.CONSOLE_BACKEND_URL || defaultBackendUrl;

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
