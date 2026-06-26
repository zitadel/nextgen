import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const consoleBase = "/ui/console/";
const consoleOutDir = "../../internal/staticui/console/dist";

export default defineConfig(({ command, isPreview }) => ({
  root: import.meta.dirname,
  // The build emits absolute `/ui/console/` asset URLs (the console embeds in
  // the Go server under that path). `vite preview` runs with command "serve",
  // so it must opt into the same base or the built index.html's asset links
  // 404 and the SPA never mounts. The dev server (plain "serve") stays at "/".
  base: command === "build" || isPreview ? consoleBase : "/",
  server: {
    port: 5174,
    strictPort: true,
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
