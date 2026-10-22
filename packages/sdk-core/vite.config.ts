import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    // The exports name `.d.mts` files, so the declarations are emitted as ES modules.
    dts({ tsconfigPath: "./tsconfig.lib.json", outDirs: { dir: "dist", moduleFormat: "esm" } }),
  ],
});
