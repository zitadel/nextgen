import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

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
      external: [/^[^./]/],
      output: {
        entryFileNames: `[name]${extension}`,
        chunkFileNames: `[name]-[hash]${extension}`,
        minify: {
          compress: {
            keepNames: {
              function: true,
              class: true,
            },
          },
          mangle: {
            keepNames: true,
          },
          codegen: {
            removeWhitespace: true,
          },
        },
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      outDirs: {
        dir: "dist",
        moduleFormat: extension === ".mjs" ? "esm" : undefined,
      },
    }),
  ],
});
