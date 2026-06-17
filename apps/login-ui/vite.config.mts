import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const uiBase = "/ui/login/";
const loginOutDir = "../../internal/staticui/login/dist";

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  base: command === "build" ? uiBase : "/",
  server: {
    port: 5175,
    strictPort: true,
  },
  cacheDir: "../../node_modules/.vite/apps/login-ui",
  resolve: { conditions: ["@zitadel/source"] },
  plugins: [keepGoEmbedPlaceholder(loginOutDir)],
  build: {
    outDir: loginOutDir,
    emptyOutDir: true,
    reportCompressedSize: true,
  },
}));

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
