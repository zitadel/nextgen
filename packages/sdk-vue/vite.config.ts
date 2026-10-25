import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";

import { failOnDiagnostics, libraryBuild } from "../../vite.shared.mjs";

export default defineConfig({
  plugins: [
    libraryBuild(import.meta.dirname),
    dts({ tsconfigPath: "./tsconfig.lib.json", afterDiagnostic: failOnDiagnostics }),
  ],
});
