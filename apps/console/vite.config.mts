import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

import { targetsOtherProject } from "./src/lib/dev-proxy";

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
    // feature. Since Console ADR 0003 the console user signs in through the
    // embedded login widget and the `__nextgen_session` cookie rides along on
    // these same-origin requests (the proxy forwards it untouched) — the
    // cookie authenticates the session operations, while the injected secret
    // still authorizes the management operations until session-derived
    // permissions land server-side (root ADRs 032/033/036); then the secret
    // is dropped here. `vite preview` is deliberately left un-proxied so it
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
  // Node-only vars — deliberately NOT VITE_ prefixed, so they are never
  // inlined into the client bundle. Vite only exposes VITE_-prefixed env-file
  // vars to the client; loading with an empty prefix here stays config-time
  // and server-side only, so `.env.local` works without exporting the vars in
  // the shell. The process environment still wins for CI/one-off overrides.
  // Normally nobody sets these by hand: `console:dev-real` (and the e2e-real
  // suite) thread both from the boot-captured @zitadel/testing instance
  // handle (`scripts/dev-real.mts`) — hand-set values are for pointing at an
  // already-running instance.
  const nodeEnv = loadEnv(mode, import.meta.dirname, "");
  const backendUrl =
    process.env.CONSOLE_BACKEND_URL || nodeEnv.CONSOLE_BACKEND_URL || defaultBackendUrl;
  const projectSecret = process.env.CONSOLE_PROJECT_SECRET ?? nodeEnv.CONSOLE_PROJECT_SECRET ?? "";
  // The project the secret belongs to. The secret is injected only for calls
  // that target it (or name no project): the server lets a Bearer win over the
  // session cookie, so injecting it on a call scoped to another project would
  // authorize as the wrong principal and hide that project as a 404. A call
  // scoped elsewhere rides on the cookie alone — the session-derived access the
  // person actually holds there (`GET /users/me/projects`, a project's admins).
  //
  // `CONSOLE_PROJECT_SECRET_PROJECT_ID` names that project explicitly; it falls
  // back to the console's own pin, which is the same project except in claim
  // mode, where the console is pinned to the platform project while the secret
  // still belongs to the seeded one being claimed (`scripts/dev-real.mts`).
  // `||`, not `??`: an empty assignment in `.env.local` means unset. With no
  // project known at all the secret is injected as before this rule existed
  // (`targetsOtherProject`), so a hand-pointed `console:dev` keeps working.
  const secretProjectId =
    process.env.CONSOLE_PROJECT_SECRET_PROJECT_ID ||
    nodeEnv.CONSOLE_PROJECT_SECRET_PROJECT_ID ||
    process.env.VITE_CONSOLE_PROJECT_ID ||
    env.VITE_CONSOLE_PROJECT_ID ||
    "";

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
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          const callerAuth = Boolean(proxyReq.getHeader("authorization"));
          const inject =
            Boolean(projectSecret) &&
            !callerAuth &&
            !targetsOtherProject(proxyReq.path, secretProjectId);
          if (inject) proxyReq.setHeader("authorization", `Bearer ${projectSecret}`);
          // `CONSOLE_DEV_PROXY_LOG=1` prints which credential each proxied
          // request went out with — the thing to look at when a screen
          // answers 401/403/404 and it is not obvious who the server saw.
          if (process.env.CONSOLE_DEV_PROXY_LOG) {
            const credential = inject
              ? "project secret"
              : callerAuth
                ? "caller's authorization"
                : "cookie only";
            console.log(`[console-proxy] ${proxyReq.method} ${proxyReq.path} → ${credential}`);
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
