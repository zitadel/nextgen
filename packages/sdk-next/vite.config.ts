import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Next.js library build: one entry per `exports` subpath. vite-plugin-dts emits
// the `.d.ts` and copies src/jsx.d.ts. React, Next and workspace deps are
// externalized — the consumer provides them.
export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "./src/index.ts",
        server: "./src/server.ts",
        client: "./src/client.ts",
        components: "./src/components.ts",
        react: "./src/react.ts",
        middleware: "./src/middleware.ts",
        session: "./src/session.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        /^@zitadel\//,
        /^react($|\/)/,
        /^react-dom($|\/)/,
        /^next($|\/)/,
        /^node:/,
        "server-only",
        "ufo",
      ],
      // Rolldown warns that a module-level directive "may not be preserved
      // when bundling"; with preserveModules it always is (see below).
      checks: { moduleLevelDirective: false },
      // One output file per source module, so each "use client" directive
      // stays at the top of its own module instead of in a shared chunk.
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      include: ["src"],
      exclude: ["src/**/*.spec.*", "src/**/*.test.*", "src/__tests__/**"],
      // Ships the hand-written src/jsx.d.ts (`exports["./jsx"]`).
      copyDtsFiles: true,
    }),
  ],
});
