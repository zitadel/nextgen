import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: "src/index.ts",
        server: "src/server.ts",
        client: "src/client.ts",
        components: "src/components.ts",
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
      },
    },
  },
  plugins: [dts({ tsconfigPath: "./tsconfig.lib.json" })],
});
