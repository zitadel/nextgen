import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // browser calls the same-origin API base with no credential; this Node-side
    // proxy injects the project secret before forwarding to the Go server, so
    // the secret never reaches the browser bundle. Attaching the bearer is
    // always the console proxy's job (mirroring our SDKs), never a Go-server
    // feature. The project secret is a temporary pre-login workaround: once the
    // console has a login, a proxy forwards the auth cookie as the bearer and the
    // secret is dropped. `vite preview` is deliberately left un-proxied so it
    // can't be mistaken for the production path.
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
  resolve: { conditions: ["@zitadel/source"] },
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
  // Public, browser-safe vars (VITE_ prefixed). The API base is the same path
  // the SDK client targets (`VITE_CONSOLE_API_BASE`, default `/api`).
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  const apiBase = env.VITE_CONSOLE_API_BASE || defaultApiBase;
  const backendUrl = env.VITE_CONSOLE_BACKEND_URL || defaultBackendUrl;
  // Node-only secret — deliberately NOT VITE_ prefixed, so it is never inlined
  // into the client bundle. Read straight from the process environment.
  const projectSecret = process.env.CONSOLE_PROJECT_SECRET ?? "";

  return {
    [apiBase]: {
      target: backendUrl,
      changeOrigin: true,
      rewrite: (path: string) => {
        const stripped = path.startsWith(apiBase) ? path.slice(apiBase.length) : path;
        return stripped.startsWith("/") ? stripped : `/${stripped}`;
      },
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          if (projectSecret && !proxyReq.getHeader("authorization")) {
            proxyReq.setHeader("authorization", `Bearer ${projectSecret}`);
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
