import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

// The files the exports publish, each built from the source file of the same name.
const targets = Object.values(pkg.exports).map((target) => target.import);
const names = targets.map((target) => target.replace(/^\.\/dist\/|\.m?js$/g, ""));
const extension = targets.every((target) => target.endsWith(".mjs")) ? ".mjs" : ".js";

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: Object.fromEntries(names.map((name) => [name, `src/${name}.ts`])),
      formats: ["es"],
    },
    rolldownOptions: {
      // Only this package's own files are bundled; every package it imports stays an import.
      external: [/^[^./]/],
      output: {
        entryFileNames: `[name]${extension}`,
        chunkFileNames: `[name]-[hash]${extension}`,
        // Minified without Vite's kept whitespace; names stay so errors and components read right.
        minify: {
          compress: { keepNames: { function: true, class: true } },
          mangle: { keepNames: true },
          codegen: { removeWhitespace: true },
        },
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      // `.d.mts` declarations beside `.mjs` files, `.d.ts` beside `.js` files.
      outDirs: { dir: "dist", moduleFormat: extension === ".mjs" ? "esm" : undefined },
    }),
  ],
});
