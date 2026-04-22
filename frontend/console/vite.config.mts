import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/frontend/console",
  plugins: [
    tailwindcss(),
    devtools(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    nxViteTsPaths(),
  ],
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: "@zitadel-nextgen/console",
    watch: false,
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
