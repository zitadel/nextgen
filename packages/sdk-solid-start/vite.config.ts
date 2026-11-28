import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

const targets = Object.values(pkg.exports).map((target) => target.import);
const names = targets.map((target) => target.replace(/^\.\/dist\/|\.m?js$/g, ""));
const extension = targets.every((target) => target.endsWith(".mjs")) ? ".mjs" : ".js";
const manifest: {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} = pkg;
const dependencies = Object.keys({
  ...manifest.dependencies,
  ...manifest.peerDependencies,
});

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: Object.fromEntries(names.map((name) => [name, `src/${name}.ts`])),
      formats: ["es"],
    },
    rolldownOptions: {
      external: (id) => {
        return dependencies.some((name) => id === name || id.startsWith(`${name}/`));
      },
      onwarn: (warning, warn) => {
        if (warning.code !== "PLUGIN_TIMINGS") {
          throw new Error(warning.message);
        }
        warn(warning);
      },
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
      afterDiagnostic: (diagnostics) => {
        if (diagnostics.length > 0) {
          throw new Error("the declarations have type errors");
        }
      },
      outDirs: {
        dir: "dist",
        moduleFormat: extension === ".mjs" ? "esm" : undefined,
      },
    }),
  ],
});
