import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

const uiBase = "/ui/login/";
const loginOutDir = "../../internal/staticui/login/dist";
const defaultDevProxyPath = "/__nextgen";
const defaultBackendUrl = "http://localhost:8080";

export default defineConfig(({ command, mode, isPreview }) => {
  return {
    root: import.meta.dirname,
    base: command === "build" || isPreview ? uiBase : "/",
    server: command === "serve" && !isPreview ? devServerConfig(mode) : baseServerConfig(),
    cacheDir: "../../node_modules/.vite/apps/login-ui",
    resolve: { conditions: ["@zitadel/source"] },
    plugins: [keepGoEmbedPlaceholder(loginOutDir)],
    build: {
      outDir: loginOutDir,
      emptyOutDir: true,
      reportCompressedSize: true,
    },
  };
});

function baseServerConfig() {
  return {
    port: 5175,
    strictPort: true,
  };
}

function devServerConfig(mode: string) {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  const proxyPath = env.VITE_PROXY_PATH || defaultDevProxyPath;
  return {
    ...baseServerConfig(),
    proxy: {
      // The deployment runtime document `src/main.ts` falls back to for the
      // default project id and its publishable key. Served at a root path by
      // the Go mux, so forward it as-is; without this the dev server answers
      // with index.html and discovery silently yields nothing.
      "/console/runtime.json": {
        target: env.VITE_BACKEND_URL || defaultBackendUrl,
        changeOrigin: true,
      },
      [proxyPath]: {
        target: env.VITE_BACKEND_URL || defaultBackendUrl,
        rewrite: (path: string) => {
          const stripped = path.startsWith(proxyPath) ? path.slice(proxyPath.length) : path;
          return stripped.startsWith("/") ? stripped : `/${stripped}`;
        },
        changeOrigin: true,
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
