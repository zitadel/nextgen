import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const consoleBase = "/ui/console/";

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  base: command === "build" ? consoleBase : "/",
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // Playground chrome lives outside `apps/console`; ensure CSS edits propagate.
      ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**"],
    },
  },
  cacheDir: "../../node_modules/.vite/apps/console",
  // Resolve workspace `@zitadel-nextgen/*` packages straight from `.ts`
  // source for hot dev iteration. Production builds pick up pre-built
  // `dist/*.mjs` via the default `import` condition instead.
  resolve: { conditions: ["@zitadel-nextgen/source"] },
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
