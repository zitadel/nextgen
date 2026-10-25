import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { failOnDiagnostics, libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    // The exports name `.d.mts` files, so the declarations are emitted as ES modules.
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      afterDiagnostic: failOnDiagnostics,
      outDirs: { dir: "dist", moduleFormat: "esm" },
    }),
  ],
});
