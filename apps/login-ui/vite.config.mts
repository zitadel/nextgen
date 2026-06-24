import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

const uiBase = "/ui/login/";
const loginOutDir = "../../internal/staticui/login/dist";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  return {
    root: import.meta.dirname,
    base: command === "build" ? uiBase : "/",
    server: {
      port: 5175,
      strictPort: true,
      proxy: {
        "/__nextgen": {
          target: env.VITE_BACKEND_URL ?? "http://localhost:8080",
          rewrite: (path) => path.replace(/^\/__nextgen/, "") || "/",
          changeOrigin: true,
        },
      },
    },
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
