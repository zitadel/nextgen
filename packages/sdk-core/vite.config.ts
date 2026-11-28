import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: "src/index.ts",
        types: "src/types.ts",
        config: "src/config.ts",
        jwt: "src/jwt.ts",
        middleware: "src/middleware.ts",
        session: "src/session.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      // Only this package's own files are bundled; every package it imports stays an import.
      external: [/^[^./]/],
      // Minified without Vite's kept whitespace; names stay so errors and components read right.
      output: {
        minify: {
          compress: { keepNames: { function: true, class: true } },
          mangle: { keepNames: true },
          codegen: { removeWhitespace: true },
        },
        // The exports name `.mjs` files.
        entryFileNames: "[name].mjs",
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      // The exports name `.d.mts` declarations.
      outDirs: { dir: "dist", moduleFormat: "esm" },
    }),
  ],
});
