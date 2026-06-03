import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vite";

const uiBase = "/ui/login/";

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  base: command === "build" ? uiBase : "/",
  server: {
    port: 5175,
    strictPort: true,
  },
  cacheDir: "../../node_modules/.vite/apps/login-ui",
  resolve: { conditions: ["@zitadel/source"] },
  plugins: [nxViteTsPaths()],
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    reportCompressedSize: true,
  },
}));
